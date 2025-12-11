import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    AttachmentBuilder,
} from "discord.js";
import { nanogpt, type ScrapeResult } from "../../api/nanogpt.ts";
import { canUseFeature } from "../../utils/features.ts";

export const data = new SlashCommandBuilder()
    .setName("scrape")
    .setDescription("Scrape content from web pages")
    .addStringOption((option) =>
        option
            .setName("url")
            .setDescription("URL to scrape")
            .setRequired(true)
    )
    .addStringOption((option) =>
        option
            .setName("url2")
            .setDescription("Additional URL to scrape")
            .setRequired(false)
    )
    .addStringOption((option) =>
        option
            .setName("url3")
            .setDescription("Additional URL to scrape")
            .setRequired(false)
    )
    .addStringOption((option) =>
        option
            .setName("url4")
            .setDescription("Additional URL to scrape")
            .setRequired(false)
    )
    .addStringOption((option) =>
        option
            .setName("url5")
            .setDescription("Additional URL to scrape")
            .setRequired(false)
    )
    .addBooleanOption((option) =>
        option
            .setName("stealth")
            .setDescription("Use stealth mode for tougher targets (5x cost)")
            .setRequired(false)
    )
    .addBooleanOption((option) =>
        option
            .setName("download")
            .setDescription("Attach results as .md file(s)")
            .setRequired(false)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    // Check feature access
    const featureCheck = canUseFeature(interaction, "SCRAPE");
    if (!featureCheck.allowed) {
        await interaction.reply({
            content: featureCheck.reason,
            ephemeral: true,
        });
        return;
    }

    // Collect URLs
    const urls: string[] = [];
    const url1 = interaction.options.getString("url", true);
    urls.push(url1);

    for (let i = 2; i <= 5; i++) {
        const url = interaction.options.getString(`url${i}`);
        if (url) {
            urls.push(url);
        }
    }

    const stealthMode = interaction.options.getBoolean("stealth") ?? false;
    const download = interaction.options.getBoolean("download") ?? false;

    // Defer the reply since scraping can take time
    await interaction.deferReply();

    try {
        const response = await nanogpt.scrapeUrls(urls, stealthMode);

        // Prepare attachments if download is requested
        const attachments: AttachmentBuilder[] = [];
        if (download) {
            for (const result of response.results) {
                if (result.success && result.markdown) {
                    const filename = sanitizeFilename(result.title || result.url) + ".md";
                    const buffer = Buffer.from(result.markdown, "utf-8");
                    attachments.push(new AttachmentBuilder(buffer, { name: filename }));
                }
            }
        }

        // Build embeds for results
        const embeds: EmbedBuilder[] = [];

        for (const result of response.results) {
            const embed = createResultEmbed(result, download);
            embeds.push(embed);
        }

        // Add summary embed
        const summaryEmbed = new EmbedBuilder()
            .setTitle("Scrape Summary")
            .addFields(
                { name: "Requested", value: String(response.summary.requested), inline: true },
                { name: "Successful", value: String(response.summary.successful), inline: true },
                { name: "Failed", value: String(response.summary.failed), inline: true },
                { name: "Total Cost", value: `$${(response.summary.totalCost ?? 0).toFixed(4)}`, inline: true },
            )
            .setTimestamp();

        if (response.summary.stealthModeUsed) {
            summaryEmbed.addFields({ name: "Mode", value: "Stealth", inline: true });
        }

        embeds.push(summaryEmbed);

        // Discord limits: max 10 embeds per message
        const embedsToSend = embeds.slice(0, 10);

        await interaction.editReply({
            embeds: embedsToSend,
            files: attachments,
        });
    } catch (error) {
        console.error("[Scrape] Error:", error);

        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";

        await interaction.editReply({
            content: `An error occurred: ${errorMessage}`,
        });
    }
}

function createResultEmbed(result: ScrapeResult, download: boolean): EmbedBuilder {
    const embed = new EmbedBuilder().setTitle(result.title || "Untitled");

    if (result.success) {
        // Show truncated markdown content if not downloading
        if (!download && result.markdown) {
            const preview = result.markdown.length > 1000
                ? result.markdown.substring(0, 1000) + "..."
                : result.markdown;
            embed.setDescription(preview);
        } else if (download) {
            embed.setDescription("Content attached as file.");
        }

        embed.setColor(0x00ff00); // Green for success
        embed.setURL(result.url);
    } else {
        embed.setDescription(`Failed: ${result.error || "Unknown error"}`);
        embed.setColor(0xff0000); // Red for failure
    }

    embed.setFooter({ text: result.url });

    return embed;
}

function sanitizeFilename(name: string): string {
    // Remove or replace invalid filename characters
    return name
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 100) || "scraped";
}
