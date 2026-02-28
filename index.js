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
    keywords: ['job', 'resume', 'interview', 'career', 'promotion', 'salary', 'cover letter', 'linkedin', 'networking', 'professional', 'skill', 'experience', 'employer', 'recruiter', 'application', 'advancement', 'development'],
    weight: 1.0
  },
  hr: {
    keywords: ['hire', 'recruit', 'employee', 'staff', 'team', 'onboarding', 'candidate', 'job posting', 'hiring', 'recruitment', 'talent', 'personnel', 'hr', 'human resources', 'applicant', 'screening', 'hiring process'],
    weight: 1.1
  },
  personal: {
        keywords: ['health', 'fitness', 'fit', 'wellness', 'diet', 'exercise', 'workout', 'gym', 'training', 'meditation', 'mental', 'family', 'relationship', 'travel', 'hobby', 'personal', 'life', 'goal', 'habit', 'self-improvement', 'wellbeing'],
    weight: 1.0
  },
  // New personal development domains
  fitness: {
    keywords: ['exercise', 'workout', 'gym', 'training', 'cardio', 'strength', 'running', 'cycling', 'yoga', 'pilates', 'stretching', 'weight loss', 'muscle', 'fitness goal', 'trainer', 'program', 'fit', 'athletic'],
    weight: 1.2
  },
  health: {
    keywords: ['health', 'wellness', 'diet', 'nutrition', 'medical', 'doctor', 'disease', 'treatment', 'supplement', 'vitamin', 'sleep', 'stress', 'immune', 'preventive', 'wellbeing', 'healthy eating', 'nutrition plan'],
    weight: 1.2
  },
  relationships: {
    keywords: ['relationship', 'dating', 'marriage', 'partner', 'spouse', 'family', 'friend', 'communication', 'conflict', 'love', 'dating advice', 'breakup', 'divorce', 'intimacy', 'commitment', 'romantic'],
    weight: 1.1
  },
  hobbies: {
    keywords: ['hobby', 'interest', 'craft', 'art', 'music', 'gaming', 'sports', 'collecting', 'DIY', 'photography', 'painting', 'drawing', 'writing', 'reading', 'cooking', 'gardening', 'creative project'],
    weight: 1.0
  },
  mental_health: {
    keywords: ['mental health', 'anxiety', 'depression', 'stress', 'therapy', 'counseling', 'mindfulness', 'meditation', 'emotional', 'psychological', 'mental wellness', 'trauma', 'PTSD', 'bipolar', 'OCD', 'mental'],
    weight: 1.3
  },
  personal_development: {
    keywords: ['personal development', 'self-improvement', 'goal setting', 'productivity', 'time management', 'habits', 'motivation', 'confidence', 'self-esteem', 'growth mindset', 'learning', 'self-help'],
    weight: 1.1
  },
  education: {
    keywords: ['education', 'learning', 'study', 'student', 'school', 'university', 'course', 'training', 'certification', 'exam', 'homework', 'assignment', 'subject', 'teacher', 'tutor', 'degree'],
    weight: 1.1
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
  hr: [
    {
      id: 'q1',
      text: 'What type of position are you hiring for?',
      answers: [
        { label: 'Entry-level', value: 'entry' },
        { label: 'Mid-level', value: 'mid' },
        { label: 'Senior/Leadership', value: 'senior' },
        { label: 'Executive', value: 'executive' },
        { label: 'Specialized/Technical', value: 'technical' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your primary hiring challenge?',
      answers: [
        { label: 'Finding qualified candidates', value: 'qualified' },
        { label: 'Screening/Filtering', value: 'screening' },
        { label: 'Interview process', value: 'interview' },
        { label: 'Retention', value: 'retention' },
        { label: 'Onboarding', value: 'onboarding' }
      ]
    },
    {
      id: 'q3',
      text: 'What industry or field?',
      answers: [
        { label: 'Technology', value: 'tech' },
        { label: 'Finance', value: 'finance' },
        { label: 'Healthcare', value: 'healthcare' },
        { label: 'Retail/Customer Service', value: 'retail' },
        { label: 'Other', value: 'other' }
      ]
    }
  ],
  fitness: [
    {
      id: 'q1',
      text: 'What type of fitness are you interested in?',
      answers: [
        { label: 'Cardio', value: 'cardio' },
        { label: 'Strength Training', value: 'strength' },
        { label: 'Flexibility/Yoga', value: 'flexibility' },
        { label: 'Sports', value: 'sports' },
        { label: 'General Fitness', value: 'general' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your current fitness level?',
      answers: [
        { label: 'Beginner', value: 'beginner' },
        { label: 'Intermediate', value: 'intermediate' },
        { label: 'Advanced', value: 'advanced' },
        { label: 'Athlete', value: 'athlete' },
        { label: 'Recovering from injury', value: 'recovering' }
      ]
    },
    {
      id: 'q3',
      text: 'What is your main fitness goal?',
      answers: [
        { label: 'Weight loss', value: 'weight_loss' },
        { label: 'Muscle gain', value: 'muscle_gain' },
        { label: 'Endurance', value: 'endurance' },
        { label: 'Flexibility', value: 'flexibility' },
        { label: 'Overall health', value: 'health' }
      ]
    }
  ],
  health: [
    {
      id: 'q1',
      text: 'What health area are you focused on?',
      answers: [
        { label: 'Nutrition', value: 'nutrition' },
        { label: 'Sleep', value: 'sleep' },
        { label: 'Stress management', value: 'stress' },
        { label: 'Disease prevention', value: 'prevention' },
        { label: 'General wellness', value: 'general' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your health goal?',
      answers: [
        { label: 'Weight management', value: 'weight' },
        { label: 'Energy and vitality', value: 'energy' },
        { label: 'Immunity', value: 'immunity' },
        { label: 'Disease prevention', value: 'prevention' },
        { label: 'Longevity', value: 'longevity' }
      ]
    },
    {
      id: 'q3',
      text: 'Do you have specific health concerns?',
      answers: [
        { label: 'Yes, chronic condition', value: 'chronic' },
        { label: 'Yes, recent diagnosis', value: 'recent' },
        { label: 'No, general wellness', value: 'no' },
        { label: 'Preventive care', value: 'preventive' },
        { label: 'Prefer not to say', value: 'prefer_not' }
      ]
    }
  ],
  relationships: [
    {
      id: 'q1',
      text: 'What type of relationship?',
      answers: [
        { label: 'Romantic/Dating', value: 'romantic' },
        { label: 'Marriage', value: 'marriage' },
        { label: 'Family', value: 'family' },
        { label: 'Friendship', value: 'friendship' },
        { label: 'Professional', value: 'professional' }
      ]
    },
    {
      id: 'q2',
      text: 'What is the main issue?',
      answers: [
        { label: 'Communication', value: 'communication' },
        { label: 'Conflict/Disagreement', value: 'conflict' },
        { label: 'Intimacy', value: 'intimacy' },
        { label: 'Trust/Commitment', value: 'trust' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q3',
      text: 'What outcome do you want?',
      answers: [
        { label: 'Improve relationship', value: 'improve' },
        { label: 'End relationship', value: 'end' },
        { label: 'Maintain status quo', value: 'maintain' },
        { label: 'Deepen connection', value: 'deepen' },
        { label: 'Clarify feelings', value: 'clarify' }
      ]
    }
  ],
  hobbies: [
    {
      id: 'q1',
      text: 'What type of hobby?',
      answers: [
        { label: 'Creative (art, music, writing)', value: 'creative' },
        { label: 'Active (sports, outdoor)', value: 'active' },
        { label: 'Intellectual (reading, gaming)', value: 'intellectual' },
        { label: 'Collecting', value: 'collecting' },
        { label: 'DIY/Making', value: 'diy' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your experience level?',
      answers: [
        { label: 'Beginner', value: 'beginner' },
        { label: 'Intermediate', value: 'intermediate' },
        { label: 'Advanced', value: 'advanced' },
        { label: 'Expert', value: 'expert' },
        { label: 'Just exploring', value: 'exploring' }
      ]
    },
    {
      id: 'q3',
      text: 'What do you want to achieve?',
      answers: [
        { label: 'Learn and improve', value: 'learn' },
        { label: 'Share with others', value: 'share' },
        { label: 'Monetize', value: 'monetize' },
        { label: 'Relax and enjoy', value: 'relax' },
        { label: 'Compete', value: 'compete' }
      ]
    }
  ],
  mental_health: [
    {
      id: 'q1',
      text: 'What is your main concern?',
      answers: [
        { label: 'Anxiety', value: 'anxiety' },
        { label: 'Depression', value: 'depression' },
        { label: 'Stress', value: 'stress' },
        { label: 'Trauma/PTSD', value: 'trauma' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q2',
      text: 'Are you currently in treatment?',
      answers: [
        { label: 'Yes, with therapist', value: 'therapy' },
        { label: 'Yes, with medication', value: 'medication' },
        { label: 'No, but considering', value: 'considering' },
        { label: 'No, self-managing', value: 'self' },
        { label: 'Prefer not to say', value: 'prefer_not' }
      ]
    },
    {
      id: 'q3',
      text: 'What support are you looking for?',
      answers: [
        { label: 'Self-help strategies', value: 'self_help' },
        { label: 'Professional resources', value: 'professional' },
        { label: 'Community support', value: 'community' },
        { label: 'Crisis resources', value: 'crisis' },
        { label: 'Information/Education', value: 'education' }
      ]
    }
  ],
  personal_development: [
    {
      id: 'q1',
      text: 'What area of development?',
      answers: [
        { label: 'Productivity', value: 'productivity' },
        { label: 'Confidence/Self-esteem', value: 'confidence' },
        { label: 'Skills', value: 'skills' },
        { label: 'Habits', value: 'habits' },
        { label: 'Mindset', value: 'mindset' }
      ]
    },
    {
      id: 'q2',
      text: 'What is your main goal?',
      answers: [
        { label: 'Achieve specific goal', value: 'achieve' },
        { label: 'Build new habit', value: 'habit' },
        { label: 'Overcome challenge', value: 'overcome' },
        { label: 'Learn new skill', value: 'skill' },
        { label: 'General growth', value: 'growth' }
      ]
    },
    {
      id: 'q3',
      text: 'What is your timeline?',
      answers: [
        { label: 'Immediate (days)', value: 'immediate' },
        { label: 'Short-term (weeks)', value: 'short' },
        { label: 'Medium-term (months)', value: 'medium' },
        { label: 'Long-term (year+)', value: 'long' },
        { label: 'No specific timeline', value: 'flexible' }
      ]
    }
  ],
  education: [
    {
      id: 'q1',
      text: 'What education level?',
      answers: [
        { label: 'K-12', value: 'k12' },
        { label: 'College/University', value: 'college' },
        { label: 'Graduate', value: 'graduate' },
        { label: 'Professional/Certification', value: 'professional' },
        { label: 'Self-study', value: 'self' }
      ]
    },
    {
      id: 'q2',
      text: 'What subject area?',
      answers: [
        { label: 'STEM', value: 'stem' },
        { label: 'Humanities', value: 'humanities' },
        { label: 'Business', value: 'business' },
        { label: 'Arts', value: 'arts' },
        { label: 'Other', value: 'other' }
      ]
    },
    {
      id: 'q3',
      text: 'What is your goal?',
      answers: [
        { label: 'Pass exam', value: 'pass' },
        { label: 'Understand concept', value: 'understand' },
        { label: 'Improve grades', value: 'grades' },
        { label: 'Master skill', value: 'master' },
        { label: 'General learning', value: 'general' }
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

// ============================================================================
// PROMPT SCORING FUNCTION (v0.2.4 - FIXED)
// ============================================================================

function calculatePromptScore(prompt) {
  let score = 0;
  
  // Clarity (0-25)
  const hasGoal = /goal|objective|want|need|aim|purpose/i.test(prompt);
  const hasContext = /because|since|for|to|in order to/i.test(prompt);
  const hasConstraints = /without|except|only|must|should|cannot/i.test(prompt);
  score += hasGoal ? 10 : 0;
  score += hasContext ? 8 : 0;
  score += hasConstraints ? 7 : 0;
  
  // Structure (0-25)
  const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgLength = prompt.length / Math.max(1, sentences.length);
  score += Math.min(10, sentences.length * 3);
  score += avgLength > 50 ? 5 : 0;
  
  // Completeness (0-25)
  const wordCount = prompt.split(/\s+/).length;
  score += Math.min(15, wordCount);
  
  // Specificity (0-25)
  const hasNumbers = /\d+/.test(prompt);
  const hasQuotes = /["'`]/.test(prompt);
  const hasExamples = /example|such as|like|for instance/i.test(prompt);
  score += hasNumbers ? 5 : 0;
  score += hasQuotes ? 5 : 0;
  score += hasExamples ? 5 : 0;
  
  return Math.min(100, Math.round(score));
}


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
    const systemPrompt = buildSystemPrompt(domain, context?.context || context, refinementAnswers);


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

    // Calculate score (v0.2.4 - FIXED: returns before/after scores 0-100)
    const scoreBefore = calculatePromptScore(prompt);
    const scoreAfter = calculatePromptScore(improvedPrompt);
    const scoreImprovement = scoreAfter - scoreBefore;
    
    console.log('[Improve Prompt v0.2.4] Score calculation:', {
      before: scoreBefore,
      after: scoreAfter,
      improvement: scoreImprovement
    });



    // Generate context-aware questions (v0.2.0)
    const contextAwareQuestions = generateContextAwareQuestions(domain, context);

    // Log success (v0.2.0)
    console.log(`[Improve Prompt v0.2.0] Success:`, {
      originalLength: prompt.length,
      improvedLength: improvedPrompt.length,
      score: score,
      questionsGenerated: contextAwareQuestions.length
    });

    // Return response (v0.2.4 - FIXED: score is now before/after object)
    const responseData = {
      success: true,
      improved: improvedPrompt,
      score: {
        before: scoreBefore,
        after: scoreAfter,
        improvement: scoreImprovement
      },
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
  let message = `Improve this prompt:
  ${prompt}`;
  if (context && context.previousPrompts && context.previousPrompts.length > 0) {
    message += `

    CONVERSATION CONTEXT:
    This is prompt #${context.previousPrompts.length + 1} about: "${context.conversationTopic || 'various topics'}"
    
    Previous prompts:
    ${context.previousPrompts.map((p, i) => `${i+1}. "${p.original}"`).join('\n')}
    
    Use this context to create an improvement that builds on the previous prompts.`;
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
              // ===== EARLY RETURN FOR FOLLOW-UPS (v1.7 - TWO-STEP TRANSFORMATION) =====
          // For follow-up prompts: Step 1 consolidate context, Step 2 apply transformation rules
          console.log('[SERVER] FOLLOW-UP MODE: Two-step transformation (consolidate + transform)');
          return `You are a senior prompt improvement specialist.

                  ## STEP 1: CONSOLIDATE CONTEXT
                  
                  The user has been having a multi-turn conversation. Here are the previous prompts:
                  
                  Topic: ${context.conversationTopic || 'various topics'}
                  
                  Previous prompts:
                  ${context.previousPrompts.map((p, i) => `${i+1}. "${p.original}" (domain: ${p.domain})`).join('\n')}
                  
                  First, understand what the user is really asking for across all these prompts. Identify:
                  - The core objective that connects all prompts
                  - The themes and topics being explored
                  - The progression and evolution of the request
                  - What the user is ultimately trying to achieve
                  
                  ## STEP 2: APPLY COMPREHENSIVE TRANSFORMATION RULES
                  
                  Now improve the current prompt by applying these transformation rules:
                  
                  ### Rule 1: Add Structure
                  Break the prompt into clear, logical sections:
                  - Goal/Objective: What does the user want to achieve?
                  - Context: What background information or constraints are relevant?
                  - Constraints: What limitations or requirements exist?
                  - Output Format: How should the response be structured?
                  
                  ### Rule 2: Clarify Goal/Outcome
                  Make success criteria explicit and measurable:
                  - Define what "success" looks like
                  - Specify the desired output format and length
                  - Clarify the target audience or use case
                  - Add examples if helpful
                  
                  ### Rule 3: Inject Always-On Guardrails
                  Add behavioral constraints to improve reliability:
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
                  
                  ## CRITICAL INSTRUCTIONS FOR FOLLOW-UPS
                  
                  1. **Build on previous context**: Use the consolidated understanding from Step 1
                  2. **Show progression**: Demonstrate how this prompt builds on or evolves from previous ones
                  3. **Add depth**: Make the prompt significantly more comprehensive than the original
                  4. **Maintain consistency**: Keep the same tone and style as the conversation
                  5. **Avoid generic templates**: Return a well-structured, specific prompt tailored to the context
                  
                  ## OUTPUT REQUIREMENTS
                  
                  Return ONLY the improved prompt. No explanations, no preamble, no meta-commentary.
                  The improved prompt should be ready to use immediately and significantly more comprehensive than the original.`;
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
