/**
 * FixMyPrompt – Backend Server v1.5
 * Comprehensive backend with domain detection, question generation, context management
 * 
 * Features:
 * - Prompt improvement (v1.0 - backward compatible)
 * - Domain detection (v1.5)
 * - Question generation (v1.5)
 * - Context management (v1.5)
 */

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const NODE_ENV = process.env.NODE_ENV || "production";

// Middleware
app.use(express.json({ limit: "10kb" })); // Limit payload size

// CORS configuration - allow all chrome-extension origins
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://chatgpt.com",
      "https://www.chatgpt.com",
      "https://claude.ai",
      "https://www.claude.ai"
    ];
    
    if (!origin || origin.startsWith("chrome-extension://" )) {
      callback(null, true);
    }
    else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    }
    else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400
};


app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Rate limiting (10 requests per minute per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/", limiter);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ============================================================================
// STORAGE ABSTRACTION LAYER (for future premium features)
// ============================================================================

// In-memory storage for MVP (will be replaced with Supabase for premium)
const contextStore = new Map();

class ContextStorage {
  async saveContext(conversationId, context) {
    try {
      contextStore.set(conversationId, {
        ...context,
        savedAt: new Date().toISOString()
      });
      return { success: true };
    } catch (error) {
      console.error("[ContextStorage] Error saving context:", error);
      throw error;
    }
  }

  async getContext(conversationId) {
    try {
      const context = contextStore.get(conversationId);
      return context || null;
    } catch (error) {
      console.error("[ContextStorage] Error retrieving context:", error);
      throw error;
    }
  }

  async deleteContext(conversationId) {
    try {
      contextStore.delete(conversationId);
      return { success: true };
    } catch (error) {
      console.error("[ContextStorage] Error deleting context:", error);
      throw error;
    }
  }
}

const storage = new ContextStorage();

// ============================================================================
// DOMAIN DETECTION SERVICE (v1.5)
// ============================================================================

const DOMAIN_KEYWORDS = {
  technical: {
    keywords: ['code', 'python', 'javascript', 'function', 'algorithm', 'debug', 'api', 'database', 'server', 'optimize', 'performance', 'sql', 'react', 'node', 'git', 'docker', 'aws', 'programming', 'software', 'development', 'framework', 'library'],
    weight: 1.0
  },
  creative: {
    keywords: ['story', 'write', 'poem', 'creative', 'fiction', 'character', 'plot', 'dialogue', 'narrative', 'script', 'song', 'art', 'design', 'visual', 'imagine', 'brainstorm', 'idea', 'concept'],
    weight: 1.0
  },
  business: {
    keywords: ['business', 'marketing', 'sales', 'strategy', 'revenue', 'customer', 'product', 'market', 'growth', 'roi', 'profit', 'investment', 'startup', 'entrepreneur', 'brand', 'campaign', 'analytics', 'metrics'],
    weight: 1.0
  },
  finance: {
    keywords: ['billionaire', 'millionaire', 'wealth', 'financial', 'investment', 'money', 'income', 'earn', 'accumulate', 'portfolio', 'stock', 'crypto', 'trading', 'passive income', 'financial independence', 'net worth', 'asset', 'capital', 'dividend', 'return', 'yield', 'rich', 'wealthy'],
    weight: 1.2
  },
  academic: {
    keywords: ['research', 'paper', 'study', 'analysis', 'theory', 'hypothesis', 'experiment', 'data', 'conclusion', 'literature', 'academic', 'education', 'learning', 'course', 'thesis', 'essay'],
    weight: 1.0
  },
  career: {
    keywords: ['job', 'resume', 'interview', 'career', 'promotion', 'salary', 'cover letter', 'linkedin', 'networking', 'professional', 'skill', 'experience', 'employer', 'recruiter', 'application'],
    weight: 1.0
  },
  personal: {
    keywords: ['health', 'fitness', 'wellness', 'diet', 'exercise', 'meditation', 'mental', 'family', 'relationship', 'travel', 'hobby', 'personal', 'life', 'goal', 'habit'],
    weight: 1.0
  }
};

function detectDomain(prompt) {
  const lowerPrompt = prompt.toLowerCase();
  const scores = {};

  // Initialize scores
  Object.keys(DOMAIN_KEYWORDS).forEach(domain => {
    scores[domain] = 0;
  });

  // Calculate scores based on keyword matches
  Object.entries(DOMAIN_KEYWORDS).forEach(([domain, config]) => {
    config.keywords.forEach(keyword => {
      if (lowerPrompt.includes(keyword)) {
        scores[domain] += config.weight;
      }
    });
  });

  // Find domain with highest score
  let maxScore = 0;
  let detectedDomain = 'general';
  let confidence = 0;

  Object.entries(scores).forEach(([domain, score]) => {
    if (score > maxScore) {
      maxScore = score;
      detectedDomain = domain;
    }
  });

  // Calculate confidence (0-1)
  const totalKeywords = Object.values(DOMAIN_KEYWORDS).reduce((sum, config) => sum + config.keywords.length, 0);
  confidence = Math.min(maxScore / 10, 1); // Normalize to 0-1

  return {
    domain: detectedDomain,
    confidence: parseFloat(confidence.toFixed(2)),
    scores: scores
  };
}

// ============================================================================
// QUESTION GENERATION SERVICE (v1.5)
// ============================================================================

const DOMAIN_QUESTIONS = {
  finance: [
    {
      id: 'q1',
      text: 'What is your primary financial goal?',
      answers: [
        { label: 'Wealth accumulation', value: 'wealth' },
        { label: 'Investment strategy', value: 'investment' },
        { label: 'Financial independence', value: 'independence' },
        { label: 'Passive income', value: 'passive' },
        { label: 'Risk management', value: 'risk' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your investment experience level?',
      answers: [
        { label: 'Beginner', value: 'beginner' },
        { label: 'Intermediate', value: 'intermediate' },
        { label: 'Advanced', value: 'advanced' },
        { label: 'Expert', value: 'expert' },
        { label: 'Not investing yet', value: 'none' }
      ]
    },
    {
      id: 'q3',
      text: 'What financial areas interest you?',
      answers: [
        { label: 'Stocks/Equities', value: 'stocks' },
        { label: 'Cryptocurrency', value: 'crypto' },
        { label: 'Real Estate', value: 'realestate' },
        { label: 'Bonds/Fixed Income', value: 'bonds' },
        { label: 'Diversified Portfolio', value: 'diversified' }
      ]
    }
  ],
  technical: [
    {
      id: 'q1',
      text: 'What programming language or technology are you working with?',
      answers: [
        { label: 'Python', value: 'python' },
        { label: 'JavaScript/Node.js', value: 'javascript' },
        { label: 'Java', value: 'java' },
        { label: 'C++', value: 'cpp' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your primary goal?',
      answers: [
        { label: 'Optimize performance', value: 'performance' },
        { label: 'Fix a bug', value: 'bug' },
        { label: 'Learn/understand', value: 'learn' },
        { label: 'Design/architecture', value: 'design' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q3',
      text: 'What is your experience level?',
      answers: [
        { label: 'Beginner', value: 'beginner' },
        { label: 'Intermediate', value: 'intermediate' },
        { label: 'Advanced', value: 'advanced' },
        { label: 'Expert', value: 'expert' }
      ]
    }
  ],
  creative: [
    {
      id: 'q1',
      text: 'What type of creative content are you working on?',
      answers: [
        { label: 'Story/Fiction', value: 'story' },
        { label: 'Poetry', value: 'poetry' },
        { label: 'Script/Dialogue', value: 'script' },
        { label: 'Visual/Design', value: 'visual' },
        { label: 'Music/Audio', value: 'music' }
      ]
    },
    {
      id: 'q2',
      text: 'Who is your target audience?',
      answers: [
        { label: 'Children', value: 'children' },
        { label: 'Teenagers', value: 'teens' },
        { label: 'Adults', value: 'adults' },
        { label: 'Professionals', value: 'professionals' },
        { label: 'General', value: 'general' }
      ]
    },
    {
      id: 'q3',
      text: 'What tone or style do you prefer?',
      answers: [
        { label: 'Serious/Dramatic', value: 'serious' },
        { label: 'Humorous/Light', value: 'humorous' },
        { label: 'Inspirational', value: 'inspirational' },
        { label: 'Mysterious/Dark', value: 'dark' },
        { label: 'Romantic', value: 'romantic' }
      ]
    }
  ],
  business: [
    {
      id: 'q1',
      text: 'What is your business focus?',
      answers: [
        { label: 'Marketing/Sales', value: 'marketing' },
        { label: 'Strategy/Planning', value: 'strategy' },
        { label: 'Operations', value: 'operations' },
        { label: 'Finance/Investment', value: 'finance' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your company stage?',
      answers: [
        { label: 'Startup', value: 'startup' },
        { label: 'Growth Stage', value: 'growth' },
        { label: 'Established', value: 'established' },
        { label: 'Enterprise', value: 'enterprise' },
        { label: 'Non-profit', value: 'nonprofit' }
      ]
    },
    {
      id: 'q3',
      text: 'What is your primary metric?',
      answers: [
        { label: 'Revenue/Profit', value: 'revenue' },
        { label: 'Customer Acquisition', value: 'acquisition' },
        { label: 'Market Share', value: 'market' },
        { label: 'Efficiency/Cost', value: 'efficiency' },
        { label: 'Growth Rate', value: 'growth' }
      ]
    }
  ],
  academic: [
    {
      id: 'q1',
      text: 'What type of academic work are you doing?',
      answers: [
        { label: 'Research Paper', value: 'research' },
        { label: 'Thesis/Dissertation', value: 'thesis' },
        { label: 'Essay/Assignment', value: 'essay' },
        { label: 'Literature Review', value: 'literature' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q2',
      text: 'What academic level?',
      answers: [
        { label: 'Undergraduate', value: 'undergrad' },
        { label: 'Graduate/Masters', value: 'masters' },
        { label: 'PhD/Doctoral', value: 'phd' },
        { label: 'Professional', value: 'professional' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q3',
      text: 'What is your field of study?',
      answers: [
        { label: 'STEM', value: 'stem' },
        { label: 'Humanities', value: 'humanities' },
        { label: 'Social Sciences', value: 'social' },
        { label: 'Business/Economics', value: 'business' },
        { label: 'Other', value: 'other' }
      ]
    }
  ],
  career: [
    {
      id: 'q1',
      text: 'What is your career goal?',
      answers: [
        { label: 'Job Search', value: 'job_search' },
        { label: 'Promotion/Growth', value: 'promotion' },
        { label: 'Career Change', value: 'change' },
        { label: 'Skill Development', value: 'skills' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your experience level?',
      answers: [
        { label: 'Entry Level', value: 'entry' },
        { label: 'Mid-Level', value: 'mid' },
        { label: 'Senior', value: 'senior' },
        { label: 'Executive', value: 'executive' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q3',
      text: 'What industry are you in?',
      answers: [
        { label: 'Technology', value: 'tech' },
        { label: 'Finance', value: 'finance' },
        { label: 'Healthcare', value: 'healthcare' },
        { label: 'Education', value: 'education' },
        { label: 'Other', value: 'other' }
      ]
    }
  ],
  personal: [
    {
      id: 'q1',
      text: 'What is your main focus?',
      answers: [
        { label: 'Health/Fitness', value: 'health' },
        { label: 'Mental Wellness', value: 'wellness' },
        { label: 'Personal Development', value: 'development' },
        { label: 'Relationships', value: 'relationships' },
        { label: 'Hobbies/Interests', value: 'hobbies' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your current situation?',
      answers: [
        { label: 'Just Starting', value: 'starting' },
        { label: 'In Progress', value: 'progress' },
        { label: 'Struggling', value: 'struggling' },
        { label: 'Succeeding', value: 'succeeding' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q3',
      text: 'What support do you need?',
      answers: [
        { label: 'Motivation', value: 'motivation' },
        { label: 'Guidance/Advice', value: 'guidance' },
        { label: 'Resources/Tools', value: 'resources' },
        { label: 'Accountability', value: 'accountability' },
        { label: 'Other', value: 'other' }
      ]
    }
  ],
  general: [
    {
      id: 'q1',
      text: 'What is your main goal with this prompt?',
      answers: [
        { label: 'Get specific information', value: 'info' },
        { label: 'Generate creative content', value: 'creative' },
        { label: 'Solve a problem', value: 'problem' },
        { label: 'Learn something new', value: 'learn' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q2',
      text: 'Who will use the response?',
      answers: [
        { label: 'Just me', value: 'personal' },
        { label: 'My team/group', value: 'team' },
        { label: 'General audience', value: 'audience' },
        { label: 'Professional use', value: 'professional' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q3',
      text: 'What level of detail do you need?',
      answers: [
        { label: 'Brief/concise', value: 'brief' },
        { label: 'Moderate detail', value: 'moderate' },
        { label: 'Comprehensive/detailed', value: 'detailed' },
        { label: 'Very technical', value: 'technical' },
        { label: 'Simple/beginner-friendly', value: 'simple' }
      ]
    }
  ]
};

function generateQuestions(domain) {
  const questions = DOMAIN_QUESTIONS[domain] || DOMAIN_QUESTIONS['general'] || [];
  return questions.map(q => ({
    ...q,
    answers: q.answers || []
  }));
}

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    version: "1.5"
  });
});

/**
 * Domain Detection Endpoint (v1.5)
 * POST /api/detect-domain
 */
app.post("/api/detect-domain", (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid prompt: must be a non-empty string"
      });
    }

    const result = detectDomain(prompt);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("[Domain Detection] Error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to detect domain"
    });
  }
});

/**
 * Question Generation Endpoint (v1.5)
 * POST /api/generate-questions
 */
app.post("/api/generate-questions", (req, res) => {
  try {
    const { prompt, domain } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid prompt: must be a non-empty string"
      });
    }

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: "Domain is required"
      });
    }

    const questions = generateQuestions(domain);

    res.json({
      success: true,
      questions: questions
    });
  } catch (error) {
    console.error("[Question Generation] Error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to generate questions"
    });
  }
});

/**
 * Context Management Endpoint (v1.5)
 * POST /api/context - Save context
 * GET /api/context/:conversationId - Retrieve context
 */
app.post("/api/context", async (req, res) => {
  try {
    const { conversationId, context } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: "conversationId is required"
      });
    }

    if (!context) {
      return res.status(400).json({
        success: false,
        error: "context is required"
      });
    }

    await storage.saveContext(conversationId, context);

    res.json({
      success: true,
      message: "Context saved successfully"
    });
  } catch (error) {
    console.error("[Context Management] Error saving context:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to save context"
    });
  }
});

app.get("/api/context/:conversationId", async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: "conversationId is required"
      });
    }

    const context = await storage.getContext(conversationId);

    if (!context) {
      return res.status(404).json({
        success: false,
        error: "Context not found",
        found: false
      });
    }

    res.json({
      success: true,
      context: context,
      found: true
    });
  } catch (error) {
    console.error("[Context Management] Error retrieving context:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve context"
    });
  }
});

/**
 * Main prompt improvement endpoint (v1.0 - backward compatible)
 * POST /api/improve-prompt
 */
app.post("/api/improve-prompt", async (req, res) => {
  try {
    const { prompt, platform, domain, context, refinementAnswers } = req.body;

    // Validate input
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        success: false,
        error: "Invalid prompt: must be a non-empty string"
      });
    }

    if (prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Prompt cannot be empty"
      });
    }

    if (!platform || !["chatgpt", "claude"].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: "Invalid platform: must be 'chatgpt' or 'claude'"
      });
    }

    // Build comprehensive system prompt
    const systemPrompt = buildSystemPrompt(domain, context, refinementAnswers);

    // Log request details for debugging (v0.2.0)
    console.log(`[Improve Prompt v0.2.0] Request received:`, {
      promptLength: prompt.length,
      platform: platform,
      hasDomain: !!domain,
      hasContext: !!context,
      contextPrompts: context?.previousPrompts?.length || 0
    });

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: buildUserMessage(prompt, context)
        }        
      ],
      temperature: 0.3,
      max_tokens: 1000,
      top_p: 0.9
    });

    if (!response.choices || !response.choices[0] || !response.choices[0].message) {
      throw new Error("Invalid response from OpenAI API");
    }

    const improvedPrompt = response.choices[0].message.content.trim();

    // Validate improvement
    if (improvedPrompt.length < 5) {
      return res.status(500).json({
        success: false,
        error: "Generated prompt is too short"
      });
    }

    // Calculate score (v0.2.3 - handles both improvements and refinements)
    let score;
    if (refinementAnswers && Object.keys(refinementAnswers).length > 0) {
      // For refinements: score based on quality, not length
      const refinementBonus = Math.min(2, Object.keys(refinementAnswers).length * 0.5);
      score = Math.min(10, 7 + refinementBonus);
      console.log('[Improve Prompt v0.2.3] Refinement scoring - Base: 7, Bonus: ' + refinementBonus + ', Final: ' + score);
      } else {
        // For initial improvements: score based on length improvement
        score = Math.min(10, 5 + (improvedPrompt.length - prompt.length) / 50);
        console.log('[Improve Prompt v0.2.3] Improvement scoring - Length delta: ' + (improvedPrompt.length - prompt.length) + ', Score: ' + score.toFixed(1));
      }



    // Generate context-aware questions (v0.2.0)
    const contextAwareQuestions = generateContextAwareQuestions(domain, context);

    // Log success (v0.2.0)
    console.log(`[Improve Prompt v0.2.0] Success:`, {
      originalLength: prompt.length,
      improvedLength: improvedPrompt.length,
      score: score,
      questionsGenerated: contextAwareQuestions.length
    });

    // Return response (v0.2.2 - Enhanced with context info)
    const responseData = {
      success: true,
      improved: improvedPrompt,
      score: parseFloat(score.toFixed(1)),
      timestamp: Date.now(),
      // NEW in v0.2.0: context-aware questions
      questions: contextAwareQuestions,
      // NEW in v0.2.0: context awareness indicator
      contextAware: !!context && context.previousPrompts && context.previousPrompts.length > 0,
      // NEW in v0.2.6: flag to indicate if this is a refinement
      isRefinement: refinementAnswers && Object.keys(refinementAnswers).length > 0
    };
    
    // v0.2.2: Add context info for debugging
    if (context && context.previousPrompts) {
      responseData.contextUsed = {
        promptCount: context.previousPrompts.length,
        conversationTopic: context.conversationTopic || 'unknown'
      };
    }
    
    if (refinementAnswers && Object.keys(refinementAnswers).length > 0) {
      responseData.refinementApplied = true;
    }
    
    console.log('[/api/improve-prompt] Response sent - Score:', responseData.score);
    
    res.json(responseData);
    } catch (error) {
    console.error("[Prompt Improvement] Error:", error.message);

    // Map technical errors to user-friendly messages
    let statusCode = 500;
    let message = "Failed to improve prompt. Please try again.";

    if (error.status === 401) {
      statusCode = 401;
      message = "Authentication error with OpenAI API";
    } else if (error.status === 429) {
      statusCode = 429;
      message = "Rate limited by OpenAI API. Please try again later.";
    } else if (error.message && error.message.includes("timeout")) {
      statusCode = 504;
      message = "Request timed out. Please try again.";
    } else if (error.message && error.message.includes("network")) {
      statusCode = 503;
      message = "Network error. Please try again later.";
    }

    res.status(statusCode).json({
      success: false,
      error: message
    });
  }
});

// ============================================================================
// CONVERSATIONAL MEMORY SERVICE (v0.2.0 - NEW)
// ============================================================================

/**
 * Format context for system prompt integration (v0.2.0)
 * Converts accumulated context into readable instructions for the LLM
 */
function formatContextForSystemPrompt(context) {
  if (!context) {
    return '';
  }

  let contextSection = '\n### Conversational Context (v0.2.0)\n';
  
  // Add conversation topic
  if (context.conversationTopic) {
    contextSection += `The user is working on: **${context.conversationTopic}**\n`;
  }

  // Add key details
  if (context.keyDetails && context.keyDetails.length > 0) {
    contextSection += `Key details from the conversation: ${context.keyDetails.join(', ')}\n`;
  }

  // Add previous prompts summary
  if (context.previousPrompts && context.previousPrompts.length > 0) {
    contextSection += `\nPrevious prompts in this conversation:\n`;
    context.previousPrompts.slice(-3).forEach((p, idx) => {
      contextSection += `${idx + 1}. "${p.original}"\n`;
    });
    contextSection += `\nConsider this conversation history when improving the current prompt. Ensure consistency with previous improvements and avoid repeating the same suggestions.\n`;
  }

  // Add questions already asked
  if (context.questionsAsked && context.questionsAsked.length > 0) {
    contextSection += `\nQuestions already asked in this conversation: ${context.questionsAsked.join(', ')}\n`;
    contextSection += `Avoid asking these questions again.\n`;
  }

  return contextSection;
}

/**
 * Generate context-aware questions (v0.2.0)
 * Filters out questions already asked and prioritizes based on context
 */
function generateContextAwareQuestions(domain, context) {
  const baseQuestions = generateQuestions(domain);
  
  if (!context || !context.questionsAsked) {
    return baseQuestions;
  }

  // Filter out questions already asked
  const filteredQuestions = baseQuestions.filter(q => {
    return !context.questionsAsked.includes(q.text);
  });

  return filteredQuestions.length > 0 ? filteredQuestions : baseQuestions;
}

/**
 * Build user message with context (v0.2.3)
 */
function buildUserMessage(prompt, context) {
  let message = `Improve this prompt by applying transformation rules:

  ${prompt}`;

  if (context && context.previousPrompts && context.previousPrompts.length > 0) {
    // Include conversation history if available (v0.2.4)
    let conversationContext = '';
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      const recentMessages = context.conversationHistory.slice(-5);
      conversationContext = `
    RECENT CONVERSATION HISTORY:
    ${recentMessages.map(msg => `**${msg.role === 'user' ? 'User' : 'Assistant'}**: ${msg.content.substring(0, 100)}...`).join('\n')}`;
    }
    
    message += `

    CONVERSATION CONTEXT (v0.2.4):
    This is prompt #${context.previousPrompts.length} in a conversation about: "${context.conversationTopic || 'various topics'}"${conversationContext}
    
    PREVIOUS PROMPTS IN THIS CONVERSATION:
    ${context.previousPrompts.map((p, i) => (i+1) + '. "' + p.original + '"').join('\n')}
    
      KEY TOPICS DISCUSSED: ${context.keyDetails ? context.keyDetails.slice(0, 10).join(', ') : 'N/A'}
    
      CRITICAL INSTRUCTIONS - USE THIS CONTEXT (v0.2.4):
      1. REFERENCE the previous prompts to understand the FULL conversation flow
      2. BUILD ON previous improvements - do NOT repeat the same structure or guardrails
      3. CONNECT related topics - explicitly show how THIS prompt relates to earlier ones
      4. AVOID repeating guardrails already covered in previous improvements
      5. FOCUS on NEW aspects and follow-up questions not yet addressed
      6. MAINTAIN consistency with tone and structure of previous improvements
      7. SHOW UNDERSTANDING: Demonstrate you understand the user is exploring multiple related aspects of the same topic
      8. USE CONVERSATION HISTORY: Reference the actual conversation flow to show context awareness
      
      The user is building on previous context. Make this improvement show you understand the full conversation and build on it.`;
      }

    return message;
  }

/**
 * Build comprehensive system prompt for LLM orchestration
 * Enhanced with domain-specific and context-aware instructions
 */
function buildSystemPrompt(domain, context, refinementAnswers) {
  // v0.2.2 logging
  console.log('[buildSystemPrompt] Called with domain:', domain);
  console.log('[buildSystemPrompt] Context provided:', !!context);
  
  if (context && context.previousPrompts) {
    console.log('[buildSystemPrompt] Previous prompts in context:', context.previousPrompts.length);
    context.previousPrompts.forEach((p, idx) => {
      console.log('[buildSystemPrompt]   Prompt ' + (idx + 1) + ': "' + p.original.substring(0, 40) + '..." (domain: ' + p.domain + ')');
    });
  }
  let domainSpecificInstructions = '';

  // Add domain-specific instructions
  if (domain === 'technical') {
    domainSpecificInstructions = `
      ### Domain-Specific Guidance (Technical)
      - Focus on clarity and precision in technical concepts
      - Include relevant examples or code snippets where applicable
      - Consider performance implications
      - Emphasize best practices and industry standards`;
    } else if (domain === 'creative') {
      domainSpecificInstructions = `
      ### Domain-Specific Guidance (Creative)
      - Enhance narrative flow and emotional impact
      - Maintain the author's unique voice and style
      - Consider audience engagement and storytelling techniques
      - Balance creativity with clarity`;
    } else if (domain === 'business') {
      domainSpecificInstructions = `
      ### Domain-Specific Guidance (Business)
      - Focus on ROI and business impact
      - Include actionable insights and metrics
      - Consider stakeholder perspectives
      - Emphasize strategic alignment`;
    } else if (domain === 'academic') {
      domainSpecificInstructions = `
      ### Domain-Specific Guidance (Academic)
      - Ensure academic rigor and proper citations
      - Focus on research methodology and evidence
      - Consider peer review standards
      - Maintain scholarly tone`;
    } else if (domain === 'career') {
      domainSpecificInstructions = `
      ### Domain-Specific Guidance (Career)
      - Highlight relevant skills and achievements
      - Consider target audience (recruiters, hiring managers)
      - Emphasize professional growth and impact
      - Use industry-specific language`;
    } else if (domain === 'personal') {
      domainSpecificInstructions = `
      ### Domain-Specific Guidance (Personal)
      - Focus on practical, actionable advice
      - Consider personal growth and well-being
      - Be empathetic and supportive
      - Provide realistic and achievable suggestions`;
    }else if (domain === 'finance') {
      domainSpecificInstructions = `
      ### Domain-Specific Guidance (Finance)
      - Focus on financial principles and risk management
      - Consider investment goals and risk tolerance
      - Include relevant financial metrics and benchmarks
      - Emphasize long-term wealth building strategies
      - Consider tax implications and diversification`;
    }


  // Add context-aware instructions if context is provided (v0.2.0 - ENHANCED)
  // Add context-aware instructions if context is provided (v0.2.1 - FOLLOW-UP DETECTION)
  // Add context-aware instructions if context is provided (v0.2.2 - REFINEMENT DETECTION)
  let contextInstructions = '';
  if (context) {
    // Check if this is a refinement request (v0.2.2)
    const isRefinement = refinementAnswers && Object.keys(refinementAnswers).length > 0;
    console.log('[buildSystemPrompt] Refinement detected:', isRefinement);
    
    // Check if this is a follow-up prompt (not the first one)
    const isFollowUp = context.previousPrompts && context.previousPrompts.length > 1;
    console.log('[buildSystemPrompt] Follow-up detected:', isFollowUp);
    
    if (isRefinement) {
      // This is a REFINEMENT request (v0.2.2)
      contextInstructions = `
      ### Conversational Context (Refinement Request - v0.2.2)
      The user is refining a previously improved prompt based on their answers to clarifying questions.
      
      Previous prompts:
      ${context.previousPrompts.slice(-3).map((p, i) => `${i+1}. Original: "${p.original}"`).join('\n')}
      
      CRITICAL INSTRUCTIONS FOR REFINEMENT:
      1. Do NOT repeat the guardrails or structure already added in the previous improvement
      2. Focus on incorporating the refinement answers to make the prompt more specific
      3. Build on the previous improvements rather than starting from scratch
      4. Enhance the prompt based on the user's feedback and answers
      5. Make targeted, incremental improvements based on the refinement context
      `;
        } else if (isFollowUp) {
          // This is a follow-up prompt - avoid repeating guardrails
          contextInstructions = `
      ### Conversational Context (Follow-up Prompt - v0.2.1)
      This is prompt #${context.previousPrompts.length} in a conversation about: ${context.conversationTopic || 'various topics'}
      
      Previous prompts in this conversation:
      ${context.previousPrompts.slice(-3).map((p, i) => `${i+1}. "${p.original}"`).join('\n')}
      
      CRITICAL INSTRUCTIONS FOR FOLLOW-UP PROMPTS:
      1. Do NOT repeat guardrails/constraints already mentioned in previous improvements
      2. Build on previous improvements - reference what was already covered
      3. Focus on NEW aspects and follow-up questions not yet addressed
      4. Maintain consistency with the tone and structure of previous improvements
      5. If this is about a related topic (e.g., crypto after wealth building), explicitly connect them
      6. Avoid regenerating the entire prompt structure - make incremental improvements
      `;
      } else {
        // First prompt - use standard context formatting
        contextInstructions = formatContextForSystemPrompt(context);
      }
    }

  return `You are a senior prompt engineer specializing in improving AI prompts for better outcomes.

Your job is to take a user's prompt and apply comprehensive transformation rules to make it more effective and reliable.

## TRANSFORMATION RULES (Apply ALL of these)

### Rule 1: Add Structure
Break the prompt into clear, logical sections:
- Goal/Objective: What does the user want to achieve? What is the core request?
- Context: What background information, constraints, or domain knowledge is relevant?
- Constraints: What limitations, boundaries, or requirements exist?
- Output Format: How should the response be structured? (e.g., bullet points, paragraphs, code, table)

Use clear section headers or markers to organize these elements.

### Rule 2: Clarify Goal/Outcome
Make success criteria explicit and measurable:
- Define what "success" looks like for this prompt
- Specify the desired output format and length
- Clarify the target audience or use case
- Add examples if helpful to illustrate the desired outcome

### Rule 3: Inject Always-On Guardrails
Add behavioral constraints to improve reliability and reduce hallucinations:
- "Avoid hallucinations: Ground all claims in facts or explicitly mark assumptions"
- "Avoid rookie mistakes: Apply professional best practices and senior-level thinking"
- "Minimize bias: Be objective, balanced, and consider multiple perspectives"
- "Follow structure strictly: Respect the requested format and constraints"
- "Verify accuracy: Check claims against reliable sources when possible"

### Rule 4: Enforce Expert-Hat Framing
Reframe the prompt as if it's coming from a deeply experienced practitioner:
- Operator perspective: Practical, decisive, results-oriented, action-focused
- Coach perspective: Reflective, explanatory, educational, context-aware
- Blend both perspectives: Be both decisive AND thoughtful

${domainSpecificInstructions}

${contextInstructions}

## PLATFORM-AWARE HEURISTICS

### For ChatGPT:
- Emphasize clarity and structure (ChatGPT responds well to organized prompts)
- Use explicit section headers
- Include concrete examples
- Be direct and specific

### For Claude:
- Emphasize reasoning and nuance (Claude excels at nuanced analysis)
- Provide context and background
- Ask for thoughtful, balanced responses
- Encourage multi-perspective thinking

## IMPORTANT RULES

- Apply ALL FOUR transformation rules to every prompt
- Return ONLY the improved prompt (no explanations, meta-commentary, or preamble)
- Do NOT change the core intent or meaning of the user's request
- Preserve the user's original voice and perspective where possible
- If the prompt is already well-structured, enhance it rather than completely rewrite
- Never add unnecessary length; be concise while being comprehensive
- Always maintain the user's original goal as the primary focus

## OUTPUT REQUIREMENTS

Return ONLY the improved prompt. No explanations, no preamble, no meta-commentary.
The improved prompt should be ready to use immediately.`;
}

// ============================================================================
// ERROR HANDLING & 404
// ============================================================================

/**
 * Error handling middleware
 */
app.use((err, req, res, next) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found"
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`[FixMyPrompt Server v0.2.0] Running on http://localhost:${PORT}` );
  console.log(`[FixMyPrompt Server v0.2.0] Endpoints:`);
  console.log(`  - POST /api/detect-domain (v1.5)`);
  console.log(`  - POST /api/generate-questions (v1.5)`);
  console.log(`  - POST /api/context (v1.5)`);
  console.log(`  - GET /api/context/:conversationId (v1.5)`);
  console.log(`  - POST /api/improve-prompt (v0.2.0 - ENHANCED with conversational memory)`);
  console.log(`[FixMyPrompt Server v0.2.0] Features:`);
  console.log(`  ✅ Backward compatible (old requests work without changes)`);
  console.log(`  ✅ Conversational memory integration (v0.2.0)`);
  console.log(`  ✅ Context-aware questions (v0.2.0)`);
  console.log(`  ✅ Context-aware system prompts (v0.2.0)`);
  console.log(`[FixMyPrompt Server v0.2.0] Environment: ${NODE_ENV}`);
  console.log(`[FixMyPrompt Server v0.2.0] Model: gpt-4-turbo`);
  console.log(`[FixMyPrompt Server v0.2.0] CORS: Allowing all chrome-extension:// origins`);

  // Verify API key is set
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "[FixMyPrompt Server v0.2.0] ERROR: OPENAI_API_KEY environment variable not set"
    );
    process.exit(1);
  }
});

module.exports = app;
