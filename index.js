/**
 * FixMyPrompt – Backend Proxy Server
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
// This is safe because the extension validates the backend URL
const corsOptions = {
  origin: function (origin, callback) {
    // Allow all chrome-extension:// origins
    if (!origin || origin.startsWith("chrome-extension://")) {
      callback(null, true);
    }
    // Allow localhost for development
    else if (origin === "http://localhost:3000" || origin === "http://localhost:5173" ) {
      callback(null, true);
    }
    // Deny other origins
    else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Explicitly handle preflight requests
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

    if (prompt.length > 2000) {
      return res.status(400).json({
        success: false,
        error: "Prompt exceeds maximum length (2000 characters)"
      });
    }

    if (!platform || !["chatgpt", "claude"].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: "Invalid platform: must be 'chatgpt' or 'claude'"
      });
    }

    // Build system prompt for LLM orchestration
    const systemPrompt = buildSystemPrompt();

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
          content: `Improve this prompt by applying all transformation rules:\n\n${prompt}`
        }
      ],
      temperature: 0.3,
      max_tokens: 800,
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
 * Build system prompt for LLM orchestration
 */
function buildSystemPrompt() {
  return `You are a senior prompt engineer specializing in improving AI prompts.

Your job is to take a user's prompt and apply the following transformation rules to make it more effective:

1. **Add Structure**: Break the prompt into clear sections:
   - Goal/Objective: What does the user want to achieve?
   - Context: What background information is needed?
   - Constraints: What limitations or requirements exist?
   - Output Format: How should the response be structured?

2. **Clarify Goal/Outcome**: Ensure the success criteria are explicit and measurable.

3. **Inject Always-On Guardrails**: Add behavioral constraints such as:
   - Avoid hallucinations (ground claims in facts)
   - Avoid rookie mistakes (act like a senior professional)
   - Minimize bias (be objective and balanced)
   - Follow structure strictly (respect the requested format)

4. **Enforce Expert-Hat Framing**: Reframe the prompt as if it's coming from a deeply experienced practitioner:
   - Operator perspective: practical, decisive, results-oriented
   - Coach perspective: reflective, explanatory, educational

IMPORTANT RULES:
- Apply ALL four transformation rules
- Return ONLY the improved prompt
- Do NOT include explanations, meta-commentary, or preamble
- Do NOT change the core intent or meaning
- Preserve the user's original voice where possible`;
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
  console.log(`[FixMyPrompt Server] Running on http://localhost:${PORT}` );
  console.log(`[FixMyPrompt Server] Health check: GET /health`);
  console.log(`[FixMyPrompt Server] Improve prompt: POST /api/improve-prompt`);
  console.log(`[FixMyPrompt Server] Environment: ${NODE_ENV}`);
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
