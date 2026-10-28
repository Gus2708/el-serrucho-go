import { EXTRACTION_JSON_SCHEMA } from './schema.ts';

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions' as const;
export const PROVISIONAL_EXTRACTION_MODEL = 'google/gemini-3.1-flash-lite' as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB
export const DEFAULT_TIMEOUT_MS = 60000;
export const MAX_TIMEOUT_MS = 300000;

export const SYSTEM_EXTRACTION_PROMPT = `You are an automated invoice data extractor for a hardware store inventory system.
Analyze the attached document (PDF or image) and extract header, line items, and metadata according to the strict JSON schema provided.
Critical extraction rules:
1. All numeric amounts (subtotal, total, unit prices, quantities, rates, discounts) MUST be exact decimal text strings (for example: "15.0000", "1.5000"), NEVER JSON numbers, to preserve exact precision.
2. Preserve supplier product codes exactly as printed on the invoice, including leading zeros and alphanumeric characters (for example: "00142-A"). NEVER convert codes to numbers.
3. If a line item or SKU appears multiple times, preserve them as separate line items in exact invoice order. Never merge or aggregate lines.
4. If a field is missing, illegible, or not present on the document, set it to null.
5. Only transcribe amounts explicitly printed with their own labels. Do not calculate subtotal, sum line totals, or copy total into subtotal. If no labeled subtotal is printed, cabecera.subtotal must be null even when total is readable.
6. For example, if only "Total: 25.00" is printed, output subtotal=null and total="25.00". If subtotal and total are separately printed as the same amount, preserve both exact strings.
7. Do not invent unauthorized fields or grant inventory, catalog, or approval authority.`.trim();

export type ProtocolErrorCode =
  | 'invalid_api_key'
  | 'invalid_document'
  | 'dependency_error'
  | 'unauthorized'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'upstream_error'
  | 'malformed_response'
  | 'output_truncated'
  | 'refusal'
  | 'unexpected_finish_reason'
  | 'contract_violation'
  | 'timeout'
  | 'aborted';

export interface OpenRouterProtocolError {
  readonly code: ProtocolErrorCode;
  readonly message: string;
  readonly httpStatus?: number;
}

const STATIC_ERROR_MESSAGES: Record<ProtocolErrorCode, string> = {
  invalid_api_key: 'API key is missing or invalid',
  invalid_document: 'Document is invalid, unsupported, or exceeds size limit',
  dependency_error: 'Required validator or parser dependency is missing',
  unauthorized: 'Authentication failed',
  insufficient_credits: 'Insufficient credits',
  rate_limited: 'Rate limit exceeded',
  upstream_error: 'Upstream service error',
  malformed_response: 'Malformed response from upstream',
  output_truncated: 'Output truncated by model token limit',
  refusal: 'Request was refused by model or safety filter',
  unexpected_finish_reason: 'Unexpected finish reason from upstream',
  contract_violation: 'Contract schema violation',
  timeout: 'Request timed out',
  aborted: 'Request was aborted',
};

export type DocumentValidationResult =
  | { readonly ok: true; readonly mime: string; readonly extension?: string }
  | { readonly ok: false; readonly error: string };

export type DocumentValidator = (bytes: Uint8Array) => DocumentValidationResult;

export interface BuildExtractionRequestInput {
  readonly apiKey: string;
  readonly documentBytes: Uint8Array;
  readonly validateDocument: DocumentValidator;
}

export type MultimodalContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'file'; readonly file: { readonly filename: string; readonly file_data: string } }
  | { readonly type: 'image_url'; readonly image_url: { readonly url: string } };

export interface OpenRouterRequestBody {
  readonly model: typeof PROVISIONAL_EXTRACTION_MODEL;
  readonly messages: Array<{
    readonly role: 'user';
    readonly content: MultimodalContentPart[];
  }>;
  readonly response_format: {
    readonly type: 'json_schema';
    readonly json_schema: {
      readonly name: string;
      readonly strict: boolean;
      readonly schema: typeof EXTRACTION_JSON_SCHEMA;
    };
  };
  readonly max_tokens: number;
  readonly temperature: number;
  readonly provider: {
    readonly require_parameters: boolean;
    readonly data_collection: 'deny';
    readonly allow_fallbacks: boolean;
  };
}

export type BuildExtractionRequestResult =
  | {
      readonly ok: true;
      readonly url: typeof OPENROUTER_CHAT_URL;
      readonly headers: Record<string, string>;
      readonly body: OpenRouterRequestBody;
      readonly detectedMime: string;
    }
  | {
      readonly ok: false;
      readonly error: OpenRouterProtocolError;
    };

export interface SafeExtractionMetadata {
  readonly model: string;
  readonly provider: string | null;
  readonly costUsd: number | null;
  readonly tokens: {
    readonly prompt: number | null;
    readonly completion: number | null;
    readonly total: number | null;
  };
  readonly finishReason: string | null;
}

export type ContractParser<T = unknown> = (raw: unknown) =>
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly path?: string } };

export interface ExecuteExtractionInput<T = unknown> {
  readonly apiKey: string;
  readonly documentBytes: Uint8Array;
  readonly validateDocument: DocumentValidator;
  readonly parseContract: ContractParser<T>;
  readonly fetchFn?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export type ExecuteExtractionResult<T = unknown> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly metadata: SafeExtractionMetadata;
    }
  | {
      readonly ok: false;
      readonly error: OpenRouterProtocolError;
    };

function parseSafeTokenCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function buildOpenRouterExtractionRequest(
  input: BuildExtractionRequestInput
): BuildExtractionRequestResult {
  const trimmedKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!trimmedKey) {
    return {
      ok: false,
      error: { code: 'invalid_api_key', message: STATIC_ERROR_MESSAGES.invalid_api_key },
    };
  }

  if (typeof input.validateDocument !== 'function') {
    return {
      ok: false,
      error: { code: 'dependency_error', message: STATIC_ERROR_MESSAGES.dependency_error },
    };
  }

  if (!(input.documentBytes instanceof Uint8Array) || input.documentBytes.length === 0 || input.documentBytes.length > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: { code: 'invalid_document', message: STATIC_ERROR_MESSAGES.invalid_document },
    };
  }

  let valResult: DocumentValidationResult;
  try {
    valResult = input.validateDocument(input.documentBytes);
  } catch {
    return {
      ok: false,
      error: { code: 'invalid_document', message: STATIC_ERROR_MESSAGES.invalid_document },
    };
  }

  if (!valResult || !valResult.ok) {
    return {
      ok: false,
      error: { code: 'invalid_document', message: STATIC_ERROR_MESSAGES.invalid_document },
    };
  }

  const mime = valResult.mime;
  const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (!ALLOWED_MIMES.includes(mime)) {
    return {
      ok: false,
      error: { code: 'invalid_document', message: STATIC_ERROR_MESSAGES.invalid_document },
    };
  }

  const base64Data = encodeBase64(input.documentBytes);
  const dataUri = `data:${mime};base64,${base64Data}`;

  let mediaPart: MultimodalContentPart;
  if (mime === 'application/pdf') {
    mediaPart = {
      type: 'file',
      file: {
        filename: 'document.pdf',
        file_data: dataUri,
      },
    };
  } else {
    mediaPart = {
      type: 'image_url',
      image_url: {
        url: dataUri,
      },
    };
  }

  const body: OpenRouterRequestBody = {
    model: PROVISIONAL_EXTRACTION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: SYSTEM_EXTRACTION_PROMPT },
          mediaPart,
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'factura_extraccion',
        strict: true,
        schema: EXTRACTION_JSON_SCHEMA,
      },
    },
    max_tokens: 4096,
    temperature: 0.0,
    provider: {
      require_parameters: true,
      data_collection: 'deny',
      allow_fallbacks: false,
    },
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${trimmedKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  return {
    ok: true,
    url: OPENROUTER_CHAT_URL,
    headers,
    body,
    detectedMime: mime,
  };
}

export async function executeOpenRouterExtraction<T = unknown>(
  input: ExecuteExtractionInput<T>
): Promise<ExecuteExtractionResult<T>> {
  if (typeof input.parseContract !== 'function' || typeof input.validateDocument !== 'function') {
    return {
      ok: false,
      error: {
        code: 'dependency_error',
        message: STATIC_ERROR_MESSAGES.dependency_error,
      },
    };
  }

  const built = buildOpenRouterExtractionRequest({
    apiKey: input.apiKey,
    documentBytes: input.documentBytes,
    validateDocument: input.validateDocument,
  });

  if (!built.ok) {
    return { ok: false, error: built.error };
  }

  if (input.signal?.aborted) {
    return { ok: false, error: { code: 'aborted', message: STATIC_ERROR_MESSAGES.aborted } };
  }

  const rawTimeout = input.timeoutMs;
  const timeoutMs =
    typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0 && rawTimeout <= MAX_TIMEOUT_MS
      ? rawTimeout
      : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let onCallerAbort: (() => void) | undefined;
  if (input.signal) {
    onCallerAbort = () => controller.abort();
    input.signal.addEventListener('abort', onCallerAbort);
  }

  try {
    const fetchImpl = input.fetchFn || fetch;
    const response = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      redirect: 'error',
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      switch (status) {
        case 401:
          return { ok: false, error: { code: 'unauthorized', message: STATIC_ERROR_MESSAGES.unauthorized, httpStatus: status } };
        case 402:
          return { ok: false, error: { code: 'insufficient_credits', message: STATIC_ERROR_MESSAGES.insufficient_credits, httpStatus: status } };
        case 429:
          return { ok: false, error: { code: 'rate_limited', message: STATIC_ERROR_MESSAGES.rate_limited, httpStatus: status } };
        default:
          return { ok: false, error: { code: 'upstream_error', message: STATIC_ERROR_MESSAGES.upstream_error, httpStatus: status } };
      }
    }

    const contentLengthHeader = response.headers?.get?.('content-length');
    if (contentLengthHeader) {
      const len = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(len) && len > MAX_RESPONSE_BYTES) {
        return {
          ok: false,
          error: { code: 'malformed_response', message: 'Response exceeded maximum size limit' },
        };
      }
    }

    let responseText = '';
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const onAbortCancelReader = () => {
        try {
          reader.cancel().catch(() => {});
        } catch {
          // ignore
        }
      };
      controller.signal.addEventListener('abort', onAbortCancelReader);
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          if (controller.signal.aborted || input.signal?.aborted) {
            await reader.cancel();
            return {
              ok: false,
              error: {
                code: timedOut ? 'timeout' : 'aborted',
                message: timedOut ? STATIC_ERROR_MESSAGES.timeout : STATIC_ERROR_MESSAGES.aborted,
              },
            };
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              return {
                ok: false,
                error: { code: 'malformed_response', message: 'Response exceeded maximum size limit' },
              };
            }
            chunks.push(value);
          }
        }
      } finally {
        controller.signal.removeEventListener('abort', onAbortCancelReader);
        reader.releaseLock?.();
      }
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      responseText = new TextDecoder('utf-8', { fatal: true }).decode(combined);
    } else if (typeof response.text === 'function') {
      responseText = await response.text();
      if (new TextEncoder().encode(responseText).byteLength > MAX_RESPONSE_BYTES) {
        return {
          ok: false,
          error: { code: 'malformed_response', message: 'Response exceeded maximum size limit' },
        };
      }
    } else if (typeof (response as any).json === 'function') {
      const j = await (response as any).json();
      responseText = JSON.stringify(j);
    } else {
      return {
        ok: false,
        error: { code: 'malformed_response', message: 'Response body is missing or unreadable' },
      };
    }

    if (controller.signal.aborted || input.signal?.aborted) {
      return {
        ok: false,
        error: {
          code: timedOut ? 'timeout' : 'aborted',
          message: timedOut ? STATIC_ERROR_MESSAGES.timeout : STATIC_ERROR_MESSAGES.aborted,
        },
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(responseText);
    } catch {
      if (controller.signal.aborted || input.signal?.aborted) {
        return {
          ok: false,
          error: {
            code: timedOut ? 'timeout' : 'aborted',
            message: timedOut ? STATIC_ERROR_MESSAGES.timeout : STATIC_ERROR_MESSAGES.aborted,
          },
        };
      }
      return {
        ok: false,
        error: { code: 'malformed_response', message: STATIC_ERROR_MESSAGES.malformed_response },
      };
    }

    if (!json || typeof json !== 'object') {
      return {
        ok: false,
        error: { code: 'malformed_response', message: STATIC_ERROR_MESSAGES.malformed_response },
      };
    }

    const payload = json as {
      model?: unknown;
      provider?: unknown;
      choices?: unknown;
      usage?: unknown;
    };

    if (payload.model !== PROVISIONAL_EXTRACTION_MODEL) {
      return {
        ok: false,
        error: { code: 'upstream_error', message: STATIC_ERROR_MESSAGES.upstream_error },
      };
    }

    if (!Array.isArray(payload.choices) || payload.choices.length === 0 || !payload.choices[0] || typeof payload.choices[0] !== 'object') {
      return {
        ok: false,
        error: { code: 'malformed_response', message: STATIC_ERROR_MESSAGES.malformed_response },
      };
    }

    const firstChoice = payload.choices[0] as {
      finish_reason?: unknown;
      message?: { content?: unknown; refusal?: unknown };
    };

    const finishReason = typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : null;
    if (finishReason === 'length') {
      return { ok: false, error: { code: 'output_truncated', message: STATIC_ERROR_MESSAGES.output_truncated } };
    }
    if (finishReason === 'content_filter' || firstChoice.message?.refusal) {
      return { ok: false, error: { code: 'refusal', message: STATIC_ERROR_MESSAGES.refusal } };
    }
    if (finishReason !== 'stop') {
      return { ok: false, error: { code: 'unexpected_finish_reason', message: STATIC_ERROR_MESSAGES.unexpected_finish_reason } };
    }

    const rawContent = firstChoice.message?.content;
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
      return { ok: false, error: { code: 'malformed_response', message: STATIC_ERROR_MESSAGES.malformed_response } };
    }

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(rawContent);
    } catch {
      return { ok: false, error: { code: 'malformed_response', message: STATIC_ERROR_MESSAGES.malformed_response } };
    }

    let contractCheck;
    try {
      contractCheck = input.parseContract(parsedContent);
    } catch {
      return {
        ok: false,
        error: { code: 'contract_violation', message: STATIC_ERROR_MESSAGES.contract_violation },
      };
    }

    if (!contractCheck || !contractCheck.ok) {
      return {
        ok: false,
        error: {
          code: 'contract_violation',
          message: STATIC_ERROR_MESSAGES.contract_violation,
        },
      };
    }

    const usage = payload.usage as {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
      cost?: unknown;
    } | undefined;

    let costUsd: number | null = null;
    if (usage && typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0) {
      costUsd = usage.cost;
    }

    const promptTokens = parseSafeTokenCount(usage?.prompt_tokens);
    const completionTokens = parseSafeTokenCount(usage?.completion_tokens);
    const totalTokens = parseSafeTokenCount(usage?.total_tokens);

    const provider = typeof payload.provider === 'string' && payload.provider.trim() ? payload.provider.trim() : null;

    const metadata: SafeExtractionMetadata = {
      model: PROVISIONAL_EXTRACTION_MODEL,
      provider,
      costUsd,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens,
      },
      finishReason,
    };

    if (controller.signal.aborted || input.signal?.aborted) {
      return {
        ok: false,
        error: {
          code: timedOut ? 'timeout' : 'aborted',
          message: timedOut ? STATIC_ERROR_MESSAGES.timeout : STATIC_ERROR_MESSAGES.aborted,
        },
      };
    }

    return {
      ok: true,
      data: contractCheck.data,
      metadata,
    };
  } catch (error: unknown) {
    if (timedOut) {
      return { ok: false, error: { code: 'timeout', message: STATIC_ERROR_MESSAGES.timeout } };
    }
    if (input.signal?.aborted || controller.signal.aborted) {
      return { ok: false, error: { code: 'aborted', message: STATIC_ERROR_MESSAGES.aborted } };
    }
    const err = error as Error;
    if (err && err.name === 'AbortError') {
      return { ok: false, error: { code: 'aborted', message: STATIC_ERROR_MESSAGES.aborted } };
    }
    return { ok: false, error: { code: 'upstream_error', message: 'Transport or connection error' } };
  } finally {
    clearTimeout(timeoutTimer);
    if (input.signal && onCallerAbort) {
      input.signal.removeEventListener('abort', onCallerAbort);
    }
  }
}
