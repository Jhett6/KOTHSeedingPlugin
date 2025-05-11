import { promises as fs } from 'fs';
import BasePlugin from './base-plugin.js';

export default class KothSeedingPlugin extends BasePlugin {
  static get description() {
    return 'Plugin to scale KOTH settings based on player count below 50';
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      configPath: {
        required: true,
        description: 'Path to ServerSettings.json'
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.lastLevel = null;
    this.configPath = options.configPath;
    this.updateInterval = 90 * 1000; // 90 seconds
    console.log(`[KothSeedingPlugin] Initialized with configPath: ${this.configPath}`);
  }

  async mount() {
    console.log('[KothSeedingPlugin] Mounting plugin...');
    // Run initial check on startup
    console.log('[KothSeedingPlugin] Running initial updateSettings...');
    await this.updateSettings();
    // Set interval for periodic checks
    this.updateIntervalId = setInterval(() => {
      console.log('[KothSeedingPlugin] Running updateSettings...');
      this.updateSettings();
    }, this.updateInterval);
  }

  async unmount() {
    console.log('[KothSeedingPlugin] Unmounting plugin...');
    clearInterval(this.updateIntervalId);
  }

  async updateSettings() {
    const playerCount = this.server.a2sPlayerCount;
    console.log(`[KothSeedingPlugin] Player count: ${playerCount}`);
    
    // Only apply settings if player count is below 50
    if (playerCount >= 50) {
      console.log('[KothSeedingPlugin] Player count >= 50, skipping update');
      this.lastLevel = null; // Reset last level to ensure settings update when player count drops below 50
      return;
    }

    const currentLevel = this.determineLevel(playerCount);
    console.log(`[KothSeedingPlugin] Current level: ${currentLevel}, Last level: ${this.lastLevel}`);
    
    if (currentLevel === this.lastLevel) {
      console.log('[KothSeedingPlugin] Current level matches last level, skipping update');
      return;
    }

    try {
      console.log(`[KothSeedingPlugin] Reading file: ${this.configPath}`);
      const rawData = await fs.readFile(this.configPath);
      const content = rawData.toString()
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        .trim();

      console.log('[KothSeedingPlugin] File content read successfully');
      if (!content.startsWith('{')) {
        throw new Error('Invalid JSON');
      }

      const config = JSON.parse(content);
      console.log('[KothSeedingPlugin] JSON parsed successfully');
      
      // Verify config.settings exists
      if (!config.settings || typeof config.settings !== 'object') {
        console.error('[KothSeedingPlugin Error] config.settings is missing or invalid in ServerSettings.json');
        return;
      }
      
      const newSettings = this.getLevelSettings(currentLevel);
      console.log(`[KothSeedingPlugin] New settings: ${JSON.stringify(newSettings, null, 2)}`);
      
      Object.assign(config.settings, newSettings);
      console.log('[KothSeedingPlugin] Settings merged into config');
      
      await fs.writeFile(this.configPath, JSON.stringify(config, null, '\t') + '\n');
      console.log(`[KothSeedingPlugin] File written successfully: ${this.configPath}`);
      
      this.lastLevel = currentLevel;

      const msg = `[KOTH] Zone and Economy updated! - ${playerCount} players (Level ${currentLevel})`;
      console.log(`[${new Date().toISOString()}] ${msg}`);
      await this.server.rcon.broadcast(msg);
      console.log('[KothSeedingPlugin] Broadcast sent');
      
    } catch (error) {
      console.error(`[KothSeedingPlugin Error] ${error.message}`);
    }
  }

  determineLevel(playerCount) {
    const level = Math.min(Math.max(1, Math.ceil(playerCount / 5)), 10);
    console.log(`[KothSeedingPlugin] Determined level: ${level} for player count: ${playerCount}`);
    return level;
  }

  getLevelSettings(level) {
    const lerp = (min, max) => min + (max - min) * (level - 1) / 9;

    const settings = {
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
    console.log(`[KothSeedingPlugin] Generated settings for level ${level}`);
    return settings;
  }
}
