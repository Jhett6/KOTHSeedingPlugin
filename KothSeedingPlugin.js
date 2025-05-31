import { promises as fs } from 'fs';
import path from 'path';
import DiscordBasePlugin from './discord-base-plugin.js';

export default class KothSeedingPlugin extends DiscordBasePlugin {
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
    this.playerListPath = path.join(path.dirname(this.configPath), 'PlayerList.json');
    this.updateInterval = 90 * 1000; // 90 seconds
    console.log(`[KothSeedingPlugin] Initialized with configPath: ${this.configPath}, playerListPath: ${this.playerListPath}`);
  }

  async mount() {
    console.log('[KothSeedingPlugin] Mounting plugin...');
    try {
      await this.server.rcon.broadcast('[KothSeedingPlugin] Plugin mounted');
      console.log('[KothSeedingPlugin] Test RCON broadcast sent');
    } catch (error) {
      console.error(`[KothSeedingPlugin Error] Test RCON broadcast failed: ${error.message}`);
    }
    console.log('[KothSeedingPlugin] Running initial updateSettings...');
    await this.updateSettings();
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
      await fs.access(this.playerListPath, fs.constants.R_OK);
      console.log('[KothSeedingPlugin] PlayerList file exists and is readable');

      const rawData = await fs.readFile(this.playerListPath);
      const content = rawData.toString()
        .replace(/^\uFEFF/, '')
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        .trim();

      console.log(`[KothSeedingPlugin] PlayerList content read (length: ${content.length})`);
      console.log(`[KothSeedingPlugin] PlayerList content: ${content}`);
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
      if (error.code === 'ENOENT') {
        console.error('[KothSeedingPlugin Error] PlayerList.json does not exist');
      } else if (error.code === 'EACCES') {
        console.error('[KothSeedingPlugin Error] Permission denied for PlayerList.json');
      }
      return 0;
    }
  }

  // Helper function for deep merging objects
  deepMerge(target, source) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (key === 'rewards' && Array.isArray(source[key]) && Array.isArray(target[key])) {
          // Special handling for rewards array: merge by 'name'
          const newRewards = [...target[key]]; // Clone target rewards
          source[key].forEach(sourceReward => {
            if (sourceReward.name) {
              const targetIndex = newRewards.findIndex(r => r.name === sourceReward.name);
              if (targetIndex >= 0) {
                // Update existing reward
                newRewards[targetIndex] = { ...newRewards[targetIndex], ...sourceReward };
              } else {
                // Add new reward
                newRewards.push({ ...sourceReward });
              }
            }
          });
          target[key] = newRewards;
        } else if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          // If the key is an object (but not an array), recurse
          target[key] = target[key] || {};
          this.deepMerge(target[key], source[key]);
        } else if (Array.isArray(source[key])) {
          // For other arrays, replace entirely
          target[key] = source[key].map(item =>
            typeof item === 'object' && !Array.isArray(item) ? { ...item } : item
          );
        } else {
          // If the key is a primitive, overwrite it
          target[key] = source[key];
        }
      }
    }
    return target;
  }

  async updateSettings() {
    const playerCount = await this.getPlayerCount();
    console.log(`[KothSeedingPlugin] Player count: ${playerCount}`);
    
    if (playerCount >= 50 || playerCount == null) {
      console.log(`[KothSeedingPlugin] Player count >= 50 or invalid (${playerCount}), skipping update`);
      this.lastPlayerCount = null;
      return;
    }

    if (playerCount === this.lastPlayerCount) {
      console.log('[KothSeedingPlugin] Player count unchanged, skipping update');
      return;
    }

    try {
      console.log(`[KothSeedingPlugin] Checking file existence: ${this.configPath}`);
      try {
        await fs.access(this.configPath, fs.constants.R_OK | fs.constants.W_OK);
        console.log('[KothSeedingPlugin] File exists and is readable/writable');
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
      
      // Deep merge new settings into existing config.settings
      this.deepMerge(config.settings, newSettings);
      console.log('[KothSeedingPlugin] Settings deep merged into config');
      
      try {
        await fs.writeFile(this.configPath, JSON.stringify(config, null, '\t') + '\n');
        console.log(`[KothSeedingPlugin] File written successfully: ${this.configPath}`);
      } catch (error) {
        console.error(`[KothSeedingPlugin Error] File write failed: ${error.message}`);
        return;
      }
      
      this.lastPlayerCount = playerCount;

      const msg = `[KOTH] Seeding Economy updated! - ${playerCount} players (Level ${currentLevel})`;
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
      "msv timer": lerp(30, 180).toFixed(2),
      "economy": {
        "$ multiplier": 1.5,
        "xp multiplier": 1,
        "weapon xp multiplier": 4
      },
      "zone": {
        "move interval": 300,
        "move fraction": lerp(1, 0.5).toFixed(2),
        "radius multiplier": lerp(0.7, 1).toFixed(2),
        "prio radius multiplier": lerp(0.5, 1).toFixed(2),
        "half height": 30000,
        "reward update interval": lerp(10, 30).toFixed(2),
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
          "xp": Math.round(lerp(400, 200)),
          "$": Math.round(lerp(400, 200))
        },
        {
          "name": "Priority Defensive",
          "xp": Math.round(lerp(500, 200)),
          "$": Math.round(lerp(500, 200))
        },
        {
          "name": "Objective Offensive",
          "xp": Math.round(lerp(70, 100)),
          "$": Math.round(lerp(70, 100))
        },
        {
          "name": "Objective Defensive",
          "xp": Math.round(lerp(80, 100)),
          "$": Math.round(lerp(80, 100))
        },
        {
		  "name": "Bot Killed",
		  "xp": Math.round(lerp(100, 25)),
		  "$": Math.round(lerp(100, 25)),
		}
      ]
    };
    console.log(`[KothSeedingPlugin] Generated settings for level ${level}`);
    return settings;
  }
}