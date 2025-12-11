import { Collection, ChatInputCommandInteraction, SlashCommandBuilder, AutocompleteInteraction } from "discord.js";

import * as chat from "./chat.ts";
import * as models from "./models.ts";
import * as setmodel from "./setmodel.ts";
import * as usage from "./usage.ts";
import * as context from "./context.ts";
import * as help from "./help.ts";
import * as imagine from "./imagine.ts";
import * as memory from "./memory.ts";
import * as scrape from "./scrape.ts";

export interface Command {
    data: Pick<SlashCommandBuilder, "name" | "toJSON">;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
    autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const commands = new Collection<string, Command>();

// Register all commands
const commandModules = [chat, models, setmodel, usage, context, help, imagine, memory, scrape];

for (const command of commandModules) {
    commands.set(command.data.name, command as Command);
}

// Export command data for registration
export function getCommandsJSON() {
    return commandModules.map((cmd) => cmd.data.toJSON());
}

