import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    Attachment,
    AutocompleteInteraction,
} from "discord.js";
import { nanogpt, type ChatMessage, type TextPart, type ImagePart } from "../../api/nanogpt.ts";
import {
    getDefaultModel,
    getContext,
    getAllContexts,
    addMemoryMessage,
    getMemoryHistory,
    clearMemory,
    getMemoryStats,
} from "../../db/index.ts";

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || "You are a helpful AI assistant.";

const VALID_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

export const data = new SlashCommandBuilder()
    .setName("memory")
    .setDescription("Chat with AI that remembers your conversation history")
    .addSubcommand((subcommand) =>
        subcommand
            .setName("chat")
            .setDescription("Chat with AI using your conversation memory")
            .addStringOption((option) =>
                option
                    .setName("message")
                    .setDescription("Your message to the AI")
                    .setRequired(true)
            )
            .addStringOption((option) =>
                option
                    .setName("context")
                    .setDescription("Name of a saved context to include")
                    .setRequired(false)
                    .setAutocomplete(true)
            )
            .addStringOption((option) =>
                option
                    .setName("model")
                    .setDescription("Model to use for this message (overrides default)")
                    .setRequired(false)
            )
            .addBooleanOption((option) =>
                option
                    .setName("websearch")
                    .setDescription("Enable web search for real-time info ($0.006/request)")
                    .setRequired(false)
            )
            .addBooleanOption((option) =>
                option
                    .setName("deepsearch")
                    .setDescription("Enable deep web search for comprehensive info ($0.06/request)")
                    .setRequired(false)
            )
            .addAttachmentOption((option) =>
                option
                    .setName("image")
                    .setDescription("Image to analyze (png, jpg, jpeg, webp)")
                    .setRequired(false)
            )
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("clear")
            .setDescription("Clear your conversation memory")
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("view")
            .setDescription("View your recent conversation history")
            .addIntegerOption((option) =>
                option
                    .setName("count")
                    .setDescription("Number of messages to show (default: 10)")
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(50)
            )
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("stats")
            .setDescription("View your memory statistics")
    );

export async function autocomplete(interaction: AutocompleteInteraction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const guildId = interaction.guildId || "dm";
    const userId = interaction.user.id;

    try {
        // Get both user and server contexts
        const userContexts = getAllContexts(guildId, userId) || [];
        const serverContexts = getAllContexts(guildId) || [];

        // Combine and dedupe (user contexts take priority)
        const allContexts: { name: string; label: string }[] = [];
        const seenNames = new Set<string>();

        for (const ctx of userContexts) {
            if (!seenNames.has(ctx.name)) {
                seenNames.add(ctx.name);
                allContexts.push({ name: ctx.name, label: `${ctx.name} (personal)` });
            }
        }

        for (const ctx of serverContexts) {
            if (!seenNames.has(ctx.name)) {
                seenNames.add(ctx.name);
                allContexts.push({ name: ctx.name, label: `${ctx.name} (server)` });
            }
        }

        // Filter by search term and limit to 25
        const filtered = allContexts
            .filter(ctx => ctx.name.toLowerCase().includes(focusedValue))
            .slice(0, 25);

        await interaction.respond(
            filtered.map(ctx => ({ name: ctx.label, value: ctx.name }))
        );
    } catch (error) {
        console.error("[Memory Autocomplete] Error:", error);
        await interaction.respond([]);
    }
}

async function processImageAttachment(attachment: Attachment): Promise<ImagePart | null> {
    const contentType = attachment.contentType;

    if (!contentType || !VALID_IMAGE_TYPES.includes(contentType)) {
        return null;
    }

    try {
        const response = await fetch(attachment.url);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");

        return {
            type: "image_url",
            image_url: {
                url: `data:${contentType};base64,${base64}`,
            },
        };
    } catch (error) {
        console.error("[Memory] Error processing image:", error);
        return null;
    }
}

export async function execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    switch (subcommand) {
        case "chat":
            await handleChat(interaction, userId);
            break;
        case "clear":
            await handleClear(interaction, userId);
            break;
        case "view":
            await handleView(interaction, userId);
            break;
        case "stats":
            await handleStats(interaction, userId);
            break;
    }
}

async function handleChat(interaction: ChatInputCommandInteraction, userId: string) {
    const userMessage = interaction.options.getString("message", true);
    const contextName = interaction.options.getString("context");
    const modelOverride = interaction.options.getString("model");
    const webSearch = interaction.options.getBoolean("websearch") ?? false;
    const deepSearch = interaction.options.getBoolean("deepsearch") ?? false;
    const imageAttachment = interaction.options.getAttachment("image");

    const guildId = interaction.guildId || "dm";

    // Check if features are disabled via environment variables
    const isWebSearchDisabled = process.env.DISABLE_WEBSEARCH === "true";
    const isDeepSearchDisabled = process.env.DISABLE_DEEPSEARCH === "true";

    if (webSearch && isWebSearchDisabled) {
        await interaction.reply({
            content: "Web search is disabled on this bot.",
            ephemeral: true,
        });
        return;
    }

    if (deepSearch && isDeepSearchDisabled) {
        await interaction.reply({
            content: "Deep search is disabled on this bot.",
            ephemeral: true,
        });
        return;
    }

    // Defer the reply since API calls can take time
    await interaction.deferReply();

    try {
        // Determine the model to use
        const model = modelOverride || getDefaultModel(guildId, userId);

        // Determine web search mode (deep takes priority over standard)
        const webSearchMode = deepSearch ? "deep" : webSearch ? "standard" : "none";

        // Build the system prompt with optional context
        let systemContent = SYSTEM_PROMPT;

        if (contextName) {
            // Look for user context first, then fall back to server context
            const context = getContext(guildId, contextName, userId);
            if (context) {
                systemContent += `\n\n--- CONTEXT: ${context.name} (${context.source_filename}) ---\n${context.content}`;
            } else {
                await interaction.editReply({
                    content: `Context "${contextName}" not found. Use /context list to see available contexts.`,
                });
                return;
            }
        }

        // Build messages array starting with system prompt
        const messages: ChatMessage[] = [
            { role: "system", content: systemContent },
        ];

        // Get conversation history and add to messages
        const history = getMemoryHistory(userId, 50);
        for (const msg of history) {
            messages.push({
                role: msg.role as "user" | "assistant",
                content: msg.content,
            });
        }

        // Process image if provided
        if (imageAttachment) {
            const imagePart = await processImageAttachment(imageAttachment);

            if (!imagePart) {
                await interaction.editReply({
                    content: `Invalid image format. Supported formats: ${VALID_IMAGE_TYPES.join(", ")}`,
                });
                return;
            }

            // Multipart message with text and image
            const contentParts: (TextPart | ImagePart)[] = [
                { type: "text", text: userMessage },
                imagePart,
            ];
            messages.push({ role: "user", content: contentParts });
            // Store text-only version in memory
            addMemoryMessage(userId, "user", userMessage, model);
        } else {
            // Simple text message
            messages.push({ role: "user", content: userMessage });
            addMemoryMessage(userId, "user", userMessage, model);
        }

        // Make the API call
        const response = await nanogpt.chat(messages, model, { webSearch: webSearchMode });

        const assistantMessage =
            response.choices[0]?.message?.content || "No response received.";

        // Store assistant response in memory
        addMemoryMessage(userId, "assistant", assistantMessage, model);

        // Build footer with model and search info
        let footerText = `Model: ${model} | Memory`;
        if (webSearchMode === "standard") {
            footerText += " | Web Search";
        } else if (webSearchMode === "deep") {
            footerText += " | Deep Search";
        }
        if (imageAttachment) {
            footerText += " | Image";
        }

        // Handle long responses by splitting into chunks
        const MAX_LENGTH = 4000; // Leave room for embed formatting

        if (assistantMessage.length <= MAX_LENGTH) {
            const embed = new EmbedBuilder()
                .setDescription(assistantMessage)
                .setFooter({ text: footerText })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } else {
            // Split into multiple messages
            const chunks: string[] = [];
            let remaining = assistantMessage;

            while (remaining.length > 0) {
                if (remaining.length <= MAX_LENGTH) {
                    chunks.push(remaining);
                    break;
                }

                // Find a good break point
                let breakPoint = remaining.lastIndexOf("\n\n", MAX_LENGTH);
                if (breakPoint === -1 || breakPoint < MAX_LENGTH / 2) {
                    breakPoint = remaining.lastIndexOf("\n", MAX_LENGTH);
                }
                if (breakPoint === -1 || breakPoint < MAX_LENGTH / 2) {
                    breakPoint = remaining.lastIndexOf(" ", MAX_LENGTH);
                }
                if (breakPoint === -1) {
                    breakPoint = MAX_LENGTH;
                }

                chunks.push(remaining.substring(0, breakPoint));
                remaining = remaining.substring(breakPoint).trim();
            }

            // Send first chunk as the reply
            const firstEmbed = new EmbedBuilder()
                .setDescription(chunks[0])
                .setFooter({ text: `${footerText} (1/${chunks.length})` })
                .setTimestamp();

            await interaction.editReply({ embeds: [firstEmbed] });

            // Send remaining chunks as follow-up messages
            for (let i = 1; i < chunks.length; i++) {
                const embed = new EmbedBuilder()
                    .setDescription(chunks[i])
                    .setFooter({ text: `${footerText} (${i + 1}/${chunks.length})` });

                await interaction.followUp({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error("[Memory Chat] Error:", error);

        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";

        await interaction.editReply({
            content: `An error occurred: ${errorMessage}`,
        });
    }
}

async function handleClear(interaction: ChatInputCommandInteraction, userId: string) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const deleted = clearMemory(userId);

        if (deleted === 0) {
            await interaction.editReply({
                content: "Your memory is already empty.",
            });
        } else {
            await interaction.editReply({
                content: `Cleared **${deleted}** messages from your memory.`,
            });
        }
    } catch (error) {
        console.error("[Memory Clear] Error:", error);
        await interaction.editReply({
            content: "Failed to clear memory.",
        });
    }
}

async function handleView(interaction: ChatInputCommandInteraction, userId: string) {
    const count = interaction.options.getInteger("count") ?? 10;

    await interaction.deferReply({ ephemeral: true });

    try {
        const history = getMemoryHistory(userId, count);

        if (history.length === 0) {
            await interaction.editReply({
                content: "Your memory is empty. Use `/memory chat` to start a conversation.",
            });
            return;
        }

        // Format messages for display
        const formatted = history.map((msg, i) => {
            const prefix = msg.role === "user" ? "**You:**" : "**AI:**";
            // Truncate long messages
            const content = msg.content.length > 200
                ? msg.content.substring(0, 200) + "..."
                : msg.content;
            return `${prefix} ${content}`;
        }).join("\n\n");

        const embed = new EmbedBuilder()
            .setTitle("Conversation Memory")
            .setDescription(formatted.substring(0, 4000))
            .setFooter({ text: `Showing ${history.length} message(s)` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error("[Memory View] Error:", error);
        await interaction.editReply({
            content: "Failed to retrieve memory.",
        });
    }
}

async function handleStats(interaction: ChatInputCommandInteraction, userId: string) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const stats = getMemoryStats(userId);

        if (stats.count === 0) {
            await interaction.editReply({
                content: "Your memory is empty. Use `/memory chat` to start a conversation.",
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle("Memory Statistics")
            .addFields(
                { name: "Total Messages", value: stats.count.toString(), inline: true },
                {
                    name: "First Message",
                    value: stats.firstAt ? `<t:${Math.floor(stats.firstAt.getTime() / 1000)}:R>` : "N/A",
                    inline: true,
                },
                {
                    name: "Last Message",
                    value: stats.lastAt ? `<t:${Math.floor(stats.lastAt.getTime() / 1000)}:R>` : "N/A",
                    inline: true,
                }
            )
            .setFooter({ text: "Memory is global and shared across all servers" })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error("[Memory Stats] Error:", error);
        await interaction.editReply({
            content: "Failed to retrieve memory statistics.",
        });
    }
}
