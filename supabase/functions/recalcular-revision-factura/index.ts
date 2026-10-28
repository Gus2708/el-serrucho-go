import { handleFacturaRecalculationRequest } from './handler.ts';

declare const Deno: {
  serve(handler: (req: Request) => Promise<Response>): void;
};

Deno.serve(async (req: Request): Promise<Response> => {
  return handleFacturaRecalculationRequest(req);
});
