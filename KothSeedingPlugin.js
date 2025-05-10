import { promises as fs } from 'fs';
import DiscordBasePlugin from './discord-base-plugin.js';

export default class KothSeedingPlugin extends DiscordBasePlugin {
  static get description() {
    return 'Plugin to adjust KOTH settings based on player count';
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      updateInterval: {
        required: false,
        description: 'Check interval (ms)',
        default: 2 * 60 * 1000
      },
      configPath: {
        required: true,
        description: 'Path to ServerSettings.json',
        default: '/home/container/SquadGame/Saved/Koth/ServerSettings.json'
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.lastLevel = null;
    this.configPath = options.configPath;
  }

  async mount() {
    this.updateInterval = setInterval(() => this.updateSettings(), this.options.updateInterval);
  }

  async unmount() {
    clearInterval(this.updateInterval);
  }

  async updateSettings() {
    const playerCount = this.server.a2sPlayerCount;
    
    // Only apply settings if player count is below 50
    if (playerCount >= 50) {
      this.lastLevel = null; // Reset last level to ensure settings update when player count drops below 50
      return;
    }

    const currentLevel = this.determineLevel(playerCount);
    
    if (currentLevel === this.lastLevel) return;

    try {
      const rawData = await fs.readFile(this.configPath);
      const content = rawData.toString()
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        .trim();

      if (!content.startsWith('{')) throw new Error('Invalid JSON');

      const config = JSON.parse(content);
      Object.assign(config.settings, this.getLevelSettings(currentLevel));
      
      await fs.writeFile(this.configPath, JSON.stringify(config, null, '\t') + '\n');
      
      this.lastLevel = currentLevel;

      const msg = `[KOTH] Zone and Economy updated! - ${playerCount} players (Level ${currentLevel})`;
      console.log(`[${new Date().toISOString()}] ${msg}`);
      await this.server.rcon.broadcast(msg);
      
    } catch (error) {
      console.error(`[KOTH Error] ${error.message}`);
    }
  }

  determineLevel(playerCount) {
    return Math.min(Math.max(1, Math.ceil(playerCount / 5)), 10);
  }

  getLevelSettings(level) {
    const lerp = (min, max) => min + (max - min) * (level - 1) / 9;

    return {
      "zone": {
        "move interval": Math.round(lerp(60, 300)),
        "move fraction": lerp(1, 0.5).toFixed(2),
        "radius multiplier": lerp(0.5, 1).toFixed(2),
        "prio radius multiplier": lerp(0.25, 1).toFixed(2),
        "half height": 10000, // Static value
        "reward update interval": 20, // Keep original value
        "vehicle can capture": false,
        "prio vehicle can capture": false
      },
      "rewards": [
        {
          "name": "Enemy Killed",
          "xp": Math.round(lerp(200, 100)),
          "$": Math.round(lerp(200, 100))
        },
        {
          "name": "Priority Offensive",
          "xp": Math.round(lerp(600, 200)),
          "$": Math.round(lerp(600, 200))
        },
        {
          "name": "Priority Defensive",
          "xp": Math.round(lerp(600, 200)),
          "$": Math.round(lerp(600, 200))
        },
        {
          "name": "Objective Offensive",
          "xp": Math.round(lerp(25, 100)),
          "$": Math.round(lerp(25, 100))
        },
        {
          "name": "Objective Defensive",
          "xp": Math.round(lerp(25, 100)),
          "$": Math.round(lerp(25, 100))
        }
      ]
    };
  }
}
