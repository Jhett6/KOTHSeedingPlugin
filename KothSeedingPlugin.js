import { promises as fs } from 'fs';
import BasePlugin from './base-plugin.js';

export default class KothSeedingPlugin extends BasePlugin {
  static get description() {
    return 'Plugin to scale KOTH settings based on player count below 50 using PlayerList.json';
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
    this.lastPlayerCount = null;
    this.configPath = options.configPath;
    this.playerListPath = '/home/container/SquadGame/Saved/Koth/PlayerList.json'; // Adjust if needed
    this.updateInterval = 90 * 1000; // 90 seconds
    console.log(`[KothSeedingPlugin] Initialized with configPath: ${this.configPath}, playerListPath: ${this.playerListPath}`);
  }

  async mount() {
    console.log('[KothSeedingPlugin] Mounting plugin...');
    // Test RCON broadcast
    try {
      await this.server.rcon.broadcast('[KothSeedingPlugin] Plugin mounted');
      console.log('[KothSeedingPlugin] Test RCON broadcast sent');
    } catch (error) {
      console.error(`[KothSeedingPlugin Error] Test RCON broadcast failed: ${error.message}`);
    }
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

  async getPlayerCount() {
    try {
      console.log(`[KothSeedingPlugin] Checking PlayerList file: ${this.playerListPath}`);
      await fs.access(this.playerListPath);
      console.log('[KothSeedingPlugin] PlayerList file exists');

      const rawData = await fs.readFile(this.playerListPath);
      const content = rawData.toString()
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        .trim();

      console.log(`[KothSeedingPlugin] PlayerList content read (length: ${content.length})`);
      if (!content.startsWith('{') && !content.startsWith('[')) {
        console.error('[KothSeedingPlugin Error] Invalid PlayerList JSON: File does not start with { or [');
        return 0;
      }

      const data = JSON.parse(content);
      let playerCount;
      if (Array.isArray(data)) {
        playerCount = data.length;
      } else if (data.players && Array.isArray(data.players)) {
        playerCount = data.players.length;
      } else {
        console.error('[KothSeedingPlugin Error] PlayerList JSON does not contain an array or players array');
        return 0;
      }

      console.log(`[KothSeedingPlugin] Player count from PlayerList: ${playerCount}`);
      return playerCount;
    } catch (error) {
      console.error(`[KothSeedingPlugin Error] Failed to read PlayerList: ${error.message}`);
      return 0;
    }
  }

  async updateSettings() {
    const playerCount = await this.getPlayerCount();
    console.log(`[KothSeedingPlugin] Player count: ${playerCount}`);
    
    // Only apply settings if player count is below 50
    if (playerCount >= 50 || playerCount == null) {
      console.log(`[KothSeedingPlugin] Player count >= 50 or invalid (${playerCount}), skipping update`);
      this.lastPlayerCount = null; // Reset to ensure update when count drops below 50
      return;
    }

    // Use player count directly to ensure updates on any change
    if (playerCount === this.lastPlayerCount) {
      console.log('[KothSeedingPlugin] Player count unchanged, skipping update');
      return;
    }

    try {
      console.log(`[KothSeedingPlugin] Checking file existence: ${this.configPath}`);
      try {
        await fs.access(this.configPath);
        console.log('[KothSeedingPlugin] File exists');
      } catch (error) {
        console.error(`[KothSeedingPlugin Error] File not accessible: ${error.message}`);
        return;
      }

      console.log(`[KothSeedingPlugin] Reading file: ${this.configPath}`);
      const rawData = await fs.readFile(this.configPath);
      const content = rawData.toString()
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        .trim();

      console.log(`[KothSeedingPlugin] File content read (length: ${content.length})`);
      if (!content.startsWith('{')) {
        console.error('[KothSeedingPlugin Error] Invalid JSON: File does not start with {');
        return;
      }

      let config;
      try {
        config = JSON.parse(content);
        console.log('[KothSeedingPlugin] JSON parsed successfully');
      } catch (error) {
        console.error(`[KothSeedingPlugin Error] JSON parsing failed: ${error.message}`);
        return;
      }

      // Ensure config.settings exists
      if (!config.settings || typeof config.settings !== 'object') {
        console.log('[KothSeedingPlugin] config.settings missing or invalid, initializing new settings object');
        config.settings = {};
      }

      const currentLevel = this.determineLevel(playerCount);
      const newSettings = this.getLevelSettings(currentLevel);
      console.log(`[KothSeedingPlugin] New settings: ${JSON.stringify(newSettings, null, 2)}`);
      
      Object.assign(config.settings, newSettings);
      console.log('[KothSeedingPlugin] Settings merged into config');
      
      try {
        await fs.writeFile(this.configPath, JSON.stringify(config, null, '\t') + '\n');
        console.log(`[KothSeedingPlugin] File written successfully: ${this.configPath}`);
      } catch (error) {
        console.error(`[KothSeedingPlugin Error] File write failed: ${error.message}`);
        return;
      }
      
      this.lastPlayerCount = playerCount;

      const msg = `[KOTH] Zone and Economy updated! - ${playerCount} players (Level ${currentLevel})`;
      console.log(`[${new Date().toISOString()}] ${msg}`);
      try {
        await this.server.rcon.broadcast(msg);
        console.log('[KothSeedingPlugin] Broadcast sent');
      } catch (error) {
        console.error(`[KothSeedingPlugin Error] RCON broadcast failed: ${error.message}`);
      }
      
    } catch (error) {
      console.error(`[KothSeedingPlugin Error] Unexpected error: ${error.message}`);
    }
  }

  determineLevel(playerCount) {
    const level = Math.min(Math.max(1, Math.ceil(playerCount / 10)), 10);
    console.log(`[KothSeedingPlugin] Determined level: ${level} for player count: ${playerCount}`);
    return level;
  }

  getLevelSettings(level) {
    const lerp = (min, max) => min + (max - min) * (level - 1) / 9;

    const settings = {
      "msv timer": Math.round(lerp(0, 90)),
      "economy": {
        "$ multiplier": lerp(2, 1).toFixed(2),
        "xp multiplier": lerp(2, 1).toFixed(2)
      },
      "zone": {
        "move interval": Math.round(lerp(60, 300)),
        "move fraction": lerp(1, 0.5).toFixed(2),
        "radius multiplier": lerp(0.5, 1).toFixed(2),
        "prio radius multiplier": lerp(0.25, 1).toFixed(2),
        "half height": 30000,
        "reward update interval": 30,
        "vehicle can capture": false,
        "prio vehicle can capture": true
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
