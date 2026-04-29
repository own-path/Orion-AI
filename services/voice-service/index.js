import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../shared/config.js";

export class VoiceService {
  async init() {
    await fs.mkdir(config.voiceDir, { recursive: true });
  }

  async generateSpeechToFile({ text, filePrefix = "orion" }) {
    await this.init();

    if (!config.elevenLabs.apiKey || !config.elevenLabs.voiceId) {
      throw new Error("ElevenLabs configuration is incomplete");
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabs.voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": config.elevenLabs.apiKey
        },
        body: JSON.stringify({
          text,
          model_id: config.elevenLabs.modelId,
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.75
          }
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs request failed: ${response.status} ${body}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = `${filePrefix}-${Date.now()}.mp3`;
    const filePath = path.join(config.voiceDir, fileName);
    await fs.writeFile(filePath, buffer);

    return {
      fileName,
      filePath,
      audioUrl: `/audio/${fileName}`,
      contentType: "audio/mpeg"
    };
  }

  async generateSoundEffectToFile({
    text,
    filePrefix = "orion-sfx",
    modelId = config.elevenLabs.loadingSfxModelId,
    durationSeconds = config.elevenLabs.loadingSfxDurationSeconds,
    loop = false
  }) {
    await this.init();

    if (!config.elevenLabs.apiKey) {
      throw new Error("ElevenLabs API key is required");
    }

    const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": config.elevenLabs.apiKey
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        duration_seconds: durationSeconds,
        loop
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs sound generation failed: ${response.status} ${body}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = `${filePrefix}-${Date.now()}.mp3`;
    const filePath = path.join(config.voiceDir, fileName);
    await fs.writeFile(filePath, buffer);

    return {
      fileName,
      filePath,
      audioUrl: `/audio/${fileName}`,
      contentType: "audio/mpeg"
    };
  }

  async ensureLoadingSoundEffect() {
    await this.init();
    const fileName = "loading-sfx.mp3";
    const filePath = path.join(config.voiceDir, fileName);

    try {
      await fs.access(filePath);
      return {
        fileName,
        filePath,
        audioUrl: `/audio/${fileName}`,
        contentType: "audio/mpeg"
      };
    } catch {
      const generated = await this.generateSoundEffectToFile({
        text: config.elevenLabs.loadingSfxText,
        filePrefix: "loading-sfx",
        modelId: config.elevenLabs.loadingSfxModelId,
        durationSeconds: config.elevenLabs.loadingSfxDurationSeconds,
        loop: true
      });

      await fs.rename(generated.filePath, filePath);

      return {
        fileName,
        filePath,
        audioUrl: `/audio/${fileName}`,
        contentType: "audio/mpeg"
      };
    }
  }
}
