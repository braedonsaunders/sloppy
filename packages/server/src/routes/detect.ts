import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { detectProject } from '../services/project-detector.js';

const DetectQuerySchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

export async function registerDetectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/detect', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = DetectQuerySchema.parse(request.query);
      const result = detectProject(query.path);

      void reply.code(200).send({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        void reply.code(400).send({
          success: false,
          error: { message: error.errors.map(e => e.message).join(', ') },
        });
        return;
      }
      app.log.error({ error }, 'Failed to detect project');
      void reply.code(500).send({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Detection failed' },
      });
    }
  });

  app.get('/api/detect/providers', async (_request: FastifyRequest, reply: FastifyReply) => {
    const detected: Record<string, boolean> = {
      claude: !!(process.env.ANTHROPIC_API_KEY),
      openai: !!(process.env.OPENAI_API_KEY),
      gemini: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
      deepseek: !!(process.env.DEEPSEEK_API_KEY),
      mistral: !!(process.env.MISTRAL_API_KEY),
      groq: !!(process.env.GROQ_API_KEY),
      openrouter: !!(process.env.OPENROUTER_API_KEY),
      together: !!(process.env.TOGETHER_API_KEY),
      cohere: !!(process.env.COHERE_API_KEY || process.env.CO_API_KEY),
    };

    void reply.code(200).send({
      success: true,
      data: { detectedProviders: detected },
    });
  });

  app.log.info('[routes] Detect routes registered');
}
