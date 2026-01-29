/**
 * FixMyPrompt – Backend Proxy Server (Comprehensive Version)
 * Secure endpoint for prompt improvement (holds OpenAI API key)
 * 
 * IMPORTANT: This server does NOT log or persist prompts.
 * It only forwards requests to OpenAI and returns responses.
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
    if (!origin || origin.startsWith("chrome-extension://")) {
      callback(null, true);
    }
    else if (origin === "http://localhost:3000" || origin === "http://localhost:5173") {
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

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

/**
 * Main prompt improvement endpoint
 * POST /api/improve-prompt
 */
app.post("/api/improve-prompt", async (req, res) => {
  try {
    const { prompt, platform } = req.body;

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

    // v1: No length restrictions - test live and see what happens
    // Length validation removed per user requirement

    if (!platform || !["chatgpt", "claude"].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: "Invalid platform: must be 'chatgpt' or 'claude'"
      });
    }

    // Build comprehensive system prompt
    const systemPrompt = buildSystemPrompt();

    // Call OpenAI API with gpt-4.1-mini
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Improve this prompt by applying all transformation rules:\n\n${prompt}`
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

    // Return response
    res.json({
      success: true,
      improved: improvedPrompt,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("[Server] Error in /api/improve-prompt:", error.message);

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

/**
 * Build comprehensive system prompt for LLM orchestration
 */
function buildSystemPrompt() {
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

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`[FixMyPrompt Server] Running on http://localhost:${PORT}`);
  console.log(`[FixMyPrompt Server] Health check: GET /health`);
  console.log(`[FixMyPrompt Server] Improve prompt: POST /api/improve-prompt`);
  console.log(`[FixMyPrompt Server] Environment: ${NODE_ENV}`);
  console.log(`[FixMyPrompt Server] Model: gpt-4.1`);
  console.log(`[FixMyPrompt Server] No length restrictions (v1 - test live)`);
  console.log(`[FixMyPrompt Server] CORS: Allowing all chrome-extension:// origins`);

  // Verify API key is set
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "[FixMyPrompt Server] ERROR: OPENAI_API_KEY environment variable not set"
    );
    process.exit(1);
  }
});

module.exports = app;
