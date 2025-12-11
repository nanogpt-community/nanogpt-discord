import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    Attachment,
    AutocompleteInteraction,
} from "discord.js";
import { nanogpt, type ImageGenerationOptions } from "../../api/nanogpt.ts";
import { canUseFeature } from "../../utils/features.ts";

const VALID_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

// Cache for image models (refresh every 5 minutes)
let cachedImageModels: string[] = [];
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

// Known image models as fallback
const DEFAULT_IMAGE_MODELS = [
    "hidream",
    "flux-schnell",
    "flux-dev",
    "flux-pro",
    "flux-kontext",
    "recraft-v3",
    "gpt-4o-image",
    "gpt-image-1",
];

async function getImageModelsCached(): Promise<string[]> {
    const now = Date.now();
    if (cachedImageModels.length === 0 || now - cacheTimestamp > CACHE_TTL) {
        try {
            const models = await nanogpt.getImageModels();
            if (models && models.length > 0) {
                cachedImageModels = models.map((m) => m.id || m.name || "Unknown");
                cacheTimestamp = now;
            } else {
                console.log("[Imagine] API returned no models, using defaults");
                cachedImageModels = DEFAULT_IMAGE_MODELS;
            }
        } catch (error) {
            console.error("[Imagine] Error fetching image models:", error);
            // Use default models if API fails
            if (cachedImageModels.length === 0) {
                cachedImageModels = DEFAULT_IMAGE_MODELS;
            }
        }
    }
    return cachedImageModels;
}

export const data = new SlashCommandBuilder()
    .setName("imagine")
    .setDescription("Generate an image using AI")
    .addStringOption((option) =>
        option
            .setName("prompt")
            .setDescription("The text prompt to generate an image from")
            .setRequired(true)
    )
    .addStringOption((option) =>
        option
            .setName("model")
            .setDescription("Image model to use (default: hidream)")
            .setRequired(false)
            .setAutocomplete(true)
    )
    .addStringOption((option) =>
        option
            .setName("size")
            .setDescription("Image size")
            .setRequired(false)
            .addChoices(
                { name: "256x256", value: "256x256" },
                { name: "512x512", value: "512x512" },
                { name: "1024x1024", value: "1024x1024" }
            )
    )
    .addNumberOption((option) =>
        option
            .setName("guidance")
            .setDescription("How closely to follow the prompt (0-20, default: 7.5)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(20)
    )
    .addIntegerOption((option) =>
        option
            .setName("steps")
            .setDescription("Number of denoising steps (1-100, default: 30)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100)
    )
    .addIntegerOption((option) =>
        option
            .setName("seed")
            .setDescription("Random seed for reproducible results")
            .setRequired(false)
    )
    .addAttachmentOption((option) =>
        option
            .setName("image")
            .setDescription("Input image for img2img transformation")
            .setRequired(false)
    )
    .addNumberOption((option) =>
        option
            .setName("strength")
            .setDescription("Img2img strength - how much to change input image (0-1, default: 0.8)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(1)
    );

export async function autocomplete(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();

    try {
        const models = await getImageModelsCached();
        const filtered = models
            .filter((model) => model.toLowerCase().includes(focusedValue))
            .slice(0, 25);

        await interaction.respond(
            filtered.map((model) => ({ name: model, value: model }))
        );
    } catch (error) {
        console.error("[Imagine Autocomplete] Error:", error);
        await interaction.respond([]);
    }
}

async function processImageAttachment(attachment: Attachment): Promise<string | null> {
    const contentType = attachment.contentType;

    if (!contentType || !VALID_IMAGE_TYPES.includes(contentType)) {
        return null;
    }

    try {
        const response = await fetch(attachment.url);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");

        return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.error("[Imagine] Error processing image:", error);
        return null;
    }
}

export async function execute(interaction: ChatInputCommandInteraction) {
    const prompt = interaction.options.getString("prompt", true);
    const model = interaction.options.getString("model");
    const size = interaction.options.getString("size") as "256x256" | "512x512" | "1024x1024" | null;
    const guidance = interaction.options.getNumber("guidance");
    const steps = interaction.options.getInteger("steps");
    const seed = interaction.options.getInteger("seed");
    const imageAttachment = interaction.options.getAttachment("image");
    const strength = interaction.options.getNumber("strength");

    // Check feature access
    const featureCheck = canUseFeature(interaction, "IMAGEGEN");
    if (!featureCheck.allowed) {
        await interaction.reply({ content: featureCheck.reason, ephemeral: true });
        return;
    }

    // Defer the reply since image generation can take time
    await interaction.deferReply();

    try {
        // Build options
        const options: ImageGenerationOptions = {
            response_format: "url",
        };

        if (model) options.model = model;
        if (size) options.size = size;
        if (guidance !== null) options.guidance_scale = guidance;
        if (steps !== null) options.num_inference_steps = steps;
        if (seed !== null) options.seed = seed;

        // Process input image for img2img if provided
        if (imageAttachment) {
            const imageDataUrl = await processImageAttachment(imageAttachment);

            if (!imageDataUrl) {
                await interaction.editReply({
                    content: `Invalid image format. Supported formats: ${VALID_IMAGE_TYPES.join(", ")}`,
                });
                return;
            }

            options.imageDataUrl = imageDataUrl;
            if (strength !== null) options.strength = strength;
        }

        // Generate the image
        const response = await nanogpt.generateImage(prompt, options);

        if (!response.data || response.data.length === 0) {
            await interaction.editReply({
                content: "No image was generated. Please try again.",
            });
            return;
        }

        const imageUrl = response.data[0].url;

        if (!imageUrl) {
            await interaction.editReply({
                content: "Failed to get image URL from response.",
            });
            return;
        }

        // Build footer with model and options info
        const usedModel = model || "hidream";
        let footerText = `Model: ${usedModel}`;
        if (size) footerText += ` | Size: ${size}`;
        if (seed !== null) footerText += ` | Seed: ${seed}`;
        if (response.cost !== undefined) footerText += ` | Cost: $${response.cost.toFixed(4)}`;

        // Create embed with the generated image
        const embed = new EmbedBuilder()
            .setTitle("Generated Image")
            .setDescription(`**Prompt:** ${prompt.length > 200 ? prompt.substring(0, 200) + "..." : prompt}`)
            .setImage(imageUrl)
            .setFooter({ text: footerText })
            .setTimestamp();

        if (imageAttachment) {
            embed.setThumbnail(imageAttachment.url);
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error("[Imagine] Error:", error);

        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";

        await interaction.editReply({
            content: `An error occurred: ${errorMessage}`,
        });
    }
}
