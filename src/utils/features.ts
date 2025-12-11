import { ChatInputCommandInteraction } from "discord.js";

type FeatureName = "WEBSEARCH" | "DEEPSEARCH" | "IMAGEGEN" | "SCRAPE";

interface FeatureCheck {
    allowed: boolean;
    reason?: string;
}

/**
 * Check if a feature is enabled based on environment variables.
 * Environment variables follow the pattern DISABLE_<FEATURE>=false|true|admin
 * - false: Feature is enabled for everyone
 * - true: Feature is disabled for everyone
 * - admin: Feature is only available to admins
 */
export function canUseFeature(
    interaction: ChatInputCommandInteraction,
    feature: FeatureName
): FeatureCheck {
    const envVar = `DISABLE_${feature}`;
    const value = process.env[envVar]?.toLowerCase() || "false";

    // Feature is fully enabled
    if (value === "false") {
        return { allowed: true };
    }

    // Feature is fully disabled
    if (value === "true") {
        return {
            allowed: false,
            reason: `The ${feature.toLowerCase()} feature is currently disabled.`,
        };
    }

    // Feature is admin-only
    if (value === "admin") {
        const userId = interaction.user.id;

        // Check CONTEXT_ADMIN_USERS env var (comma-separated user IDs)
        const adminUsers = process.env.CONTEXT_ADMIN_USERS?.split(",").map(id => id.trim()) || [];
        if (adminUsers.includes(userId)) {
            return { allowed: true };
        }

        // Also check Discord admin permissions as fallback
        const member = interaction.member;
        if (member && "permissions" in member) {
            const permissions = member.permissions;
            const hasAdmin = typeof permissions === "string"
                ? permissions.includes("Administrator")
                : permissions.has("Administrator");
            if (hasAdmin) {
                return { allowed: true };
            }
        }

        return {
            allowed: false,
            reason: `The ${feature.toLowerCase()} feature is only available to administrators.`,
        };
    }


    // Unknown value, default to enabled
    return { allowed: true };
}
