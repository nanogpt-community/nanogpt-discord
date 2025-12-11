import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
} from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available commands and how to use them");

export async function execute(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
        .setTitle("NanoGPT Bot Help")
        .setDescription("A Discord bot powered by NanoGPT API for AI conversations with document context support.")
        .addFields(
            {
                name: "/chat",
                value: [
                    "Chat with the AI assistant.",
                    "**Options:**",
                    "• `message` (required) - Your message to the AI",
                    "• `context` - Name of a saved context to include",
                    "• `model` - Override the default model for this message",
                    "• `websearch` - Enable web search for real-time info ($0.006/req)",
                    "• `deepsearch` - Enable deep web search for comprehensive info ($0.06/req)",
                    "• `image` - Attach an image to analyze (png, jpg, jpeg, webp)",
                ].join("\n"),
                inline: false,
            },
            {
                name: "/context",
                value: [
                    "Manage document contexts for AI conversations.",
                    "**Subcommands:**",
                    "• `/context add` - Upload a document (PDF, TXT, MD, etc.)",
                    "• `/context list` - List all saved contexts",
                    "• `/context view` - View a context's content",
                    "• `/context remove` - Remove a saved context",
                    "**Scope:** Use `scope:user` (personal, default) or `scope:server` (shared)",
                ].join("\n"),
                inline: false,
            },
            {
                name: "/setmodel",
                value: [
                    "Set the default AI model.",
                    "**Options:**",
                    "• `model` (required) - The model to use",
                    "• `scope` - Apply to yourself or the entire server",
                ].join("\n"),
                inline: false,
            },
            {
                name: "/models",
                value: "List all available AI models from NanoGPT.",
                inline: false,
            },
            {
                name: "/usage",
                value: "Check your NanoGPT API usage (daily and monthly limits).",
                inline: false,
            },
            {
                name: "/imagine",
                value: [
                    "Generate images using AI.",
                    "**Options:**",
                    "• `prompt` (required) - Text description of the image",
                    "• `model` - Image model to use (autocomplete available)",
                    "• `size` - Image size (256x256, 512x512, 1024x1024)",
                    "• `guidance` - How closely to follow the prompt (0-20)",
                    "• `steps` - Denoising steps (1-100)",
                    "• `seed` - Random seed for reproducible results",
                    "• `image` - Input image for img2img transformation",
                    "• `strength` - Img2img strength (0-1)",
                ].join("\n"),
                inline: false,
            },
            {
                name: "/memory",
                value: [
                    "Chat with AI that remembers your conversation history.",
                    "**Subcommands:**",
                    "• `/memory chat` - Chat with persistent memory (same options as /chat)",
                    "• `/memory view` - View recent conversation history",
                    "• `/memory stats` - Show your memory statistics",
                    "• `/memory clear` - Clear your conversation memory",
                ].join("\n"),
                inline: false,
            }
        )
        .setFooter({ text: "Tip: Use /memory for persistent conversations, or /chat for stateless queries!" })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
