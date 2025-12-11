const NANOGPT_API_KEY = process.env.NANOGPT_API_KEY;
const BASE_URL = "https://nano-gpt.com/api";

if (!NANOGPT_API_KEY) {
    throw new Error("NANOGPT_API_KEY environment variable is required");
}

export interface TextPart {
    type: "text";
    text: string;
}

export interface ImagePart {
    type: "image_url";
    image_url: {
        url: string; // HTTPS URL or base64 data URL
    };
}

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string | (TextPart | ImagePart)[];
}

export interface ChatCompletionOptions {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    webSearch?: "none" | "standard" | "deep";
}

export interface ChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface SubscriptionUsage {
    active: boolean;
    limits: {
        daily: number;
        monthly: number;
    };
    enforceDailyLimit: boolean;
    daily: {
        used: number;
        remaining: number;
        percentUsed: number;
        resetAt: number;
    };
    monthly: {
        used: number;
        remaining: number;
        percentUsed: number;
        resetAt: number;
    };
    period: {
        currentPeriodEnd: string;
    };
    state: "active" | "grace" | "inactive";
    graceUntil: string | null;
}

export interface Model {
    id: string;
    name?: string;
    description?: string;
}

export interface ImageModel {
    id: string;
    name?: string;
    description?: string;
}

export interface ImageGenerationOptions {
    model?: string;
    n?: number;
    size?: "256x256" | "512x512" | "1024x1024";
    response_format?: "url" | "b64_json";
    imageDataUrl?: string; // Base64 image for img2img
    strength?: number;
    guidance_scale?: number;
    num_inference_steps?: number;
    seed?: number;
}

export interface ImageGenerationResponse {
    created: number;
    data: {
        url?: string;
        b64_json?: string;
    }[];
    cost?: number;
    paymentSource?: string;
    remainingBalance?: number;
}

export interface ScrapeResult {
    url: string;
    success: boolean;
    title?: string;
    content?: string;
    markdown?: string;
    error?: string;
}

export interface ScrapeSummary {
    requested: number;
    processed: number;
    successful: number;
    failed: number;
    totalCost: number;
    stealthModeUsed: boolean;
}

export interface ScrapeUrlsResponse {
    results: ScrapeResult[];
    summary: ScrapeSummary;
}

function getModelWithWebSearch(model: string, webSearch: "none" | "standard" | "deep"): string {
    switch (webSearch) {
        case "standard":
            return `${model}:online`;
        case "deep":
            return `${model}:online/linkup-deep`;
        default:
            return model;
    }
}

class NanoGPTClient {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${BASE_URL}${endpoint}`;
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...options.headers,
        };

        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`NanoGPT API error (${response.status}): ${errorText}`);
        }

        return response.json() as Promise<T>;
    }

    async chat(
        messages: ChatMessage[],
        model: string,
        options: ChatCompletionOptions = {}
    ): Promise<ChatCompletionResponse> {
        const finalModel = getModelWithWebSearch(model, options.webSearch || "none");

        return this.request<ChatCompletionResponse>("/v1/chat/completions", {
            method: "POST",
            body: JSON.stringify({
                model: finalModel,
                messages,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.max_tokens ?? 4000,
                top_p: options.top_p ?? 1,
            }),
        });
    }

    async getModels(): Promise<Model[]> {
        const response = await this.request<{ data: Model[] } | Model[]>(
            "/subscription/v1/models"
        );

        // Handle both array and { data: [...] } response formats
        if (Array.isArray(response)) {
            return response;
        }
        return response.data || [];
    }

    async getUsage(): Promise<SubscriptionUsage> {
        return this.request<SubscriptionUsage>("/subscription/v1/usage");
    }

    async generateImage(
        prompt: string,
        options: ImageGenerationOptions = {}
    ): Promise<ImageGenerationResponse> {
        const body: Record<string, unknown> = {
            prompt,
            model: options.model ?? "hidream",
            n: options.n ?? 1,
        };

        if (options.size) body.size = options.size;
        if (options.response_format) body.response_format = options.response_format;
        if (options.imageDataUrl) body.imageDataUrl = options.imageDataUrl;
        if (options.strength !== undefined) body.strength = options.strength;
        if (options.guidance_scale !== undefined) body.guidance_scale = options.guidance_scale;
        if (options.num_inference_steps !== undefined) body.num_inference_steps = options.num_inference_steps;
        if (options.seed !== undefined) body.seed = options.seed;

        return this.request<ImageGenerationResponse>("/v1/images/generations", {
            method: "POST",
            body: JSON.stringify(body),
        });
    }

    async getImageModels(): Promise<ImageModel[]> {
        const response = await this.request<{ data: ImageModel[] } | ImageModel[]>(
            "/subscription/v1/image-models"
        );

        // Handle both array and { data: [...] } response formats
        if (Array.isArray(response)) {
            return response;
        }
        return response.data || [];
    }

    async scrapeUrls(urls: string[], stealthMode: boolean = false): Promise<ScrapeUrlsResponse> {
        return this.request<ScrapeUrlsResponse>("/scrape-urls", {
            method: "POST",
            body: JSON.stringify({
                urls,
                stealthMode,
            }),
        });
    }
}

export const nanogpt = new NanoGPTClient(NANOGPT_API_KEY);
