#!/usr/bin/env node
// Optional narration for UAT videos: turn short texts into speech files, cached by voice + text.
// Used by assemble-uat-video.mjs when the manifest has a "voice" section; also a CLI for previews:
//   node narrate.mjs --voice voice.json --text "AC1 passes." --out preview.mp3
//
// Providers:
//   azure-speech  Azure AI Speech neural voices. Auth: AZURE_SPEECH_KEY, or Microsoft Entra via
//                 `az account get-access-token` plus voice.resourceId (an AI Services / Speech resource).
//   system        Offline fallback: Windows SAPI (powershell.exe), macOS `say`, Linux `espeak-ng`.
//
// Narration describes what the evidence shows; it never states a result the recording did not show.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

let cachedToken = null;

function azureToken() {
  if (cachedToken) return cachedToken;
  const r = spawnSync('az', ['account', 'get-access-token', '--resource', 'https://cognitiveservices.azure.com', '--query', 'accessToken', '-o', 'tsv'], {
    encoding: 'utf8',
    shell: process.platform === 'win32', // az is a .cmd shim on Windows; the arguments are fixed strings
  });
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error(`could not get a Microsoft Entra token from the Azure CLI (az login?): ${(r.stderr || '').trim().split('\n').pop()}`);
  }
  cachedToken = r.stdout.trim();
  return cachedToken;
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ssml(voice, text) {
  const name = voice.voice ?? 'en-US-AndrewMultilingualNeural';
  const lang = voice.lang ?? 'en-US';
  const prosody = `rate="${voice.rate ?? '+0%'}" pitch="${voice.pitch ?? '+0%'}"`;
  let inner = `<prosody ${prosody}>${xmlEscape(text)}</prosody>`;
  if (voice.style) inner = `<mstts:express-as style="${xmlEscape(voice.style)}">${inner}</mstts:express-as>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${xmlEscape(name)}">${inner}</voice></speak>`;
}

async function azureSpeech(voice, text, out) {
  if (!voice.region) throw new Error('voice.region is required for azure-speech (e.g. "eastus2")');
  const headers = {
    'Content-Type': 'application/ssml+xml',
    'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
    'User-Agent': 'uat-skill-narration',
  };
  if (process.env.AZURE_SPEECH_KEY) headers['Ocp-Apim-Subscription-Key'] = process.env.AZURE_SPEECH_KEY;
  else if (voice.resourceId) headers.Authorization = `Bearer aad#${voice.resourceId}#${azureToken()}`;
  else throw new Error('set AZURE_SPEECH_KEY, or voice.resourceId for Microsoft Entra auth');
  const res = await fetch(`https://${voice.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST', headers, body: ssml(voice, text), signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Azure Speech returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

function systemVoice(voice, text, out) {
  let r;
  if (process.platform === 'win32') {
    // Text travels through an environment variable, never through the command line.
    const ps = "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
      "if ($env:UAT_TTS_VOICE) { $s.SelectVoice($env:UAT_TTS_VOICE) }; $s.Rate = [int]$env:UAT_TTS_RATE; " +
      '$s.SetOutputToWaveFile($env:UAT_TTS_OUT); $s.Speak($env:UAT_TTS_TEXT); $s.Dispose()';
    r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      env: { ...process.env, UAT_TTS_TEXT: text, UAT_TTS_OUT: out, UAT_TTS_VOICE: voice.voice ?? '', UAT_TTS_RATE: String(voice.sapiRate ?? 0) },
    });
  } else if (process.platform === 'darwin') {
    r = spawnSync('say', [...(voice.voice ? ['-v', voice.voice] : []), '-o', out, '--data-format=LEI16@22050', text], { encoding: 'utf8' });
  } else {
    r = spawnSync('espeak-ng', [...(voice.voice ? ['-v', voice.voice] : []), '-w', out, text], { encoding: 'utf8' });
  }
  if (r.error) throw new Error(`system voice unavailable: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`system voice failed: ${(r.stderr || '').trim()}`);
}

/**
 * Synthesize text with the configured voice, caching in cacheDir. Returns the audio file path.
 */
export async function narrate(voice, text, cacheDir) {
  const provider = voice.provider ?? 'azure-speech';
  const ext = provider === 'azure-speech' ? 'mp3' : process.platform === 'darwin' ? 'aiff' : 'wav';
  const key = createHash('sha256').update(JSON.stringify({ provider, voice: voice.voice, rate: voice.rate, pitch: voice.pitch, style: voice.style, sapiRate: voice.sapiRate, text })).digest('hex').slice(0, 16);
  mkdirSync(cacheDir, { recursive: true });
  const out = join(cacheDir, `${key}.${ext}`);
  if (existsSync(out)) return out;
  // Synthesize to a temporary file and keep it only when it is complete, so a failed or partial
  // run never leaves a cached clip that later plays as silence or half a sentence.
  const tmp = `${out}.${process.pid}.tmp.${ext}`;
  try {
    if (provider === 'azure-speech') await azureSpeech(voice, text, tmp);
    else if (provider === 'system') systemVoice(voice, text, tmp);
    else throw new Error(`unknown voice.provider "${provider}" (azure-speech or system)`);
    if (!existsSync(tmp) || statSync(tmp).size === 0) throw new Error('the voice produced no audio');
    renameSync(tmp, out);
  } finally {
    rmSync(tmp, { force: true });
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { voice: { type: 'string' }, text: { type: 'string' }, out: { type: 'string' } } });
  if (!values.voice || !values.text) {
    console.error('usage: node narrate.mjs --voice voice.json --text "..." [--out file]');
    process.exit(2);
  }
  try {
    const voice = JSON.parse(readFileSync(resolve(values.voice), 'utf8'));
    const file = await narrate(voice, values.text, resolve('.narration-cache'));
    if (values.out) copyFileSync(file, resolve(values.out));
    console.log(values.out ? resolve(values.out) : file);
  } catch (e) {
    console.error(`narrate: ${e.message}`);
    process.exit(2);
  }
}
