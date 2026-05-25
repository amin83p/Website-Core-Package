const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_OUTPUT_BYTES = 35 * 1024 * 1024;
const DEFAULT_CONVERSION_TIMEOUT_MS = 90000;

function s(value, max = 4000) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\0/g, '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function isOpenAiCompatibleProvider(providerId = '') {
  const token = s(providerId, 80).toLowerCase();
  return token === 'openai' || token === 'azure-openai';
}

function isOpenAiAudioChatModel(modelId = '') {
  const token = s(modelId, 220).toLowerCase();
  if (!token) return false;
  if (token.includes('transcribe') || token.includes('whisper')) return false;
  return token.includes('audio');
}

function buildOpenAiAudioModelCompatibilityError(providerId = '', modelId = '', scorerName = 'PTE scoring') {
  const providerToken = s(providerId, 80).toLowerCase();
  if (!isOpenAiCompatibleProvider(providerToken)) return '';
  if (isOpenAiAudioChatModel(modelId)) return '';
  const modelToken = s(modelId, 220) || 'unknown';
  return `${scorerName} with provider "${providerToken}" requires an OpenAI audio chat model. Selected model "${modelToken}" cannot receive audio in this scorer. Use gpt-audio, gpt-audio-mini, gpt-4o-audio-preview, or gpt-4o-mini-audio-preview.`;
}

function isOpenAiSupportedAudioMimeType(mimeType = '') {
  const token = s(mimeType, 120).toLowerCase();
  return /audio\/(mpeg|mp3|wav|x-wav)/i.test(token);
}

function isConvertibleAudioMimeType(mimeType = '') {
  const token = s(mimeType, 120).toLowerCase();
  return /audio\/(webm|ogg|oga|mp4|m4a|x-m4a|aac|3gpp|flac)/i.test(token);
}

function resolveFfmpegPath() {
  return s(process.env.PTE_SCORING_FFMPEG_PATH, 2000)
    || s(process.env.FFMPEG_PATH, 2000)
    || 'ffmpeg';
}

function buildTempWavPath() {
  const suffix = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `pte-scoring-openai-audio-${Date.now()}-${suffix}.wav`);
}

function buildUnsupportedFormatError(providerId = '', mimeType = '', scorerName = 'PTE scoring') {
  const providerToken = s(providerId, 80).toLowerCase() || 'openai';
  return new Error(
    `${scorerName} with provider "${providerToken}" requires MP3 or WAV audio. Browser WebM/OGG/M4A/FLAC recordings can be converted to WAV when FFmpeg is available, but ${mimeType || 'this audio format'} could not be prepared for OpenAI-compatible scoring.`
  );
}

async function runNodeFfmpegShimInProcess(ffmpegPath = '', args = []) {
  const resolvedPath = require.resolve(ffmpegPath);
  const previousArgv = process.argv;
  const previousExit = process.exit;

  process.argv = [process.execPath, resolvedPath, ...args];
  process.exit = (code = 0) => {
    const error = new Error(`FFmpeg JS shim exited with code ${code}.`);
    error.code = 'PTE_FFMPEG_JS_SHIM_EXIT';
    error.exitCode = Number(code || 0);
    throw error;
  };

  try {
    delete require.cache[resolvedPath];
    const exported = require(resolvedPath);
    if (typeof exported === 'function') {
      await exported(args);
    }
  } catch (error) {
    if (error?.code === 'PTE_FFMPEG_JS_SHIM_EXIT' && Number(error.exitCode || 0) === 0) {
      return;
    }
    throw error;
  } finally {
    process.argv = previousArgv;
    process.exit = previousExit;
  }
}

async function convertAudioToWavForOpenAi(audio = {}, options = {}) {
  const inputPath = s(audio.absolutePath, 2000);
  if (!inputPath) {
    throw new Error('OpenAI-compatible scoring requires a readable local audio path before conversion.');
  }

  const outputPath = buildTempWavPath();
  const ffmpegPath = resolveFfmpegPath();
  const shouldRunNodeShim = /\.js$/i.test(ffmpegPath);
  const ffmpegCommand = shouldRunNodeShim ? process.execPath : ffmpegPath;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_CONVERSION_TIMEOUT_MS);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-acodec',
    'pcm_s16le',
    '-f',
    'wav',
    outputPath
  ];
  const commandArgs = shouldRunNodeShim ? [ffmpegPath, ...args] : args;

  try {
    try {
      await execFileAsync(ffmpegCommand, commandArgs, {
        timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CONVERSION_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      if (!shouldRunNodeShim || !['EPERM', 'EACCES'].includes(String(error?.code || ''))) {
        throw error;
      }
      await runNodeFfmpegShimInProcess(ffmpegPath, args);
    }

    const stat = await fs.stat(outputPath);
    if (!stat.isFile() || Number(stat.size || 0) <= 0) {
      throw new Error('FFmpeg produced an empty audio file.');
    }
    const maxOutputBytes = Number(options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES);
    if (Number.isFinite(maxOutputBytes) && maxOutputBytes > 0 && Number(stat.size || 0) > maxOutputBytes) {
      throw new Error(`Converted audio is too large for v1 scoring (max ${Math.floor(maxOutputBytes / (1024 * 1024))}MB).`);
    }

    const buffer = await fs.readFile(outputPath);
    return {
      ...audio,
      absolutePath: outputPath,
      mimeType: 'audio/wav',
      dataBase64: buffer.toString('base64'),
      sizeBytes: Number(stat.size || buffer.length || 0),
      originalMimeType: s(audio.mimeType, 120),
      originalAbsolutePath: inputPath,
      convertedForProvider: 'openai-compatible'
    };
  } catch (error) {
    await fs.unlink(outputPath).catch(() => {});
    if (error?.code === 'ENOENT') {
      throw new Error('FFmpeg is not available on the server, so browser audio could not be converted for OpenAI-compatible scoring.');
    }
    throw error;
  }
}

async function prepareAudioForScoringProvider({
  providerId = '',
  audio = {},
  scorerName = 'PTE scoring',
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  converter = convertAudioToWavForOpenAi
} = {}) {
  const providerToken = s(providerId, 80).toLowerCase();
  const sourceMimeType = s(audio.mimeType, 120).toLowerCase();
  const baseMetadata = {
    providerId: providerToken,
    sourceMimeType,
    preparedMimeType: sourceMimeType,
    converted: false,
    conversionTool: null
  };
  const cleanup = async () => {};

  if (!isOpenAiCompatibleProvider(providerToken)) {
    return {
      audio,
      cleanup,
      metadata: {}
    };
  }

  if (isOpenAiSupportedAudioMimeType(sourceMimeType)) {
    return {
      audio,
      cleanup,
      metadata: baseMetadata
    };
  }

  if (!isConvertibleAudioMimeType(sourceMimeType)) {
    throw buildUnsupportedFormatError(providerToken, sourceMimeType, scorerName);
  }

  let convertedAudio = null;
  try {
    convertedAudio = await converter(audio, { maxOutputBytes, scorerName });
  } catch (error) {
    const wrapped = buildUnsupportedFormatError(providerToken, sourceMimeType, scorerName);
    wrapped.cause = error;
    wrapped.code = 'PTE_SCORING_OPENAI_AUDIO_PREPARATION_FAILED';
    wrapped.message = `${wrapped.message} ${s(error?.message || error, 500)}`;
    throw wrapped;
  }

  return {
    audio: convertedAudio,
    cleanup: async () => {
      const convertedPath = s(convertedAudio?.absolutePath, 2000);
      const originalPath = s(audio?.absolutePath, 2000);
      if (convertedPath && convertedPath !== originalPath) {
        await fs.unlink(convertedPath).catch(() => {});
      }
    },
    metadata: {
      ...baseMetadata,
      preparedMimeType: 'audio/wav',
      converted: true,
      conversionTool: 'ffmpeg'
    }
  };
}

module.exports = {
  isOpenAiCompatibleProvider,
  isOpenAiAudioChatModel,
  buildOpenAiAudioModelCompatibilityError,
  isOpenAiSupportedAudioMimeType,
  isConvertibleAudioMimeType,
  prepareAudioForScoringProvider,
  convertAudioToWavForOpenAi
};
