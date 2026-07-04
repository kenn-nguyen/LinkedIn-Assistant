(function initPromptPackRuntime(global) {
  const APP_COMPAT_VERSION = 1;
  const DEFAULT_PROMPT_PACK_ID = "default";
  // Also the set of prompt keys loaded from the pack manifest (see loadBuiltInPromptPack).
  const PROMPT_OVERRIDE_KEYS = Object.freeze([
    "relationship",
    "relationship_retry",
    "email",
    "post_suggestions",
    "job_outreach_search_url",
    "job_outreach_ranking"
  ]);
  const VISIBLE_PROMPT_TEMPLATE_KEYS = Object.freeze([
    "relationship",
    "relationship_retry",
    "post_suggestions",
    "job_outreach_ranking"
  ]);
  const BUILT_IN_PROMPT_LABELS = Object.freeze({
    relationship: "Relationship draft",
    relationship_retry: "Relationship retry",
    post_suggestions: "Post suggestions",
    job_outreach_search_url: "Job outreach search URLs",
    job_outreach_ranking: "Job outreach ranking"
  });

  const packCache = new Map();
  const packLoadPromises = new Map();

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .trim();
  }

  function defaultPromptPackSettings() {
    return {
      activePackId: DEFAULT_PROMPT_PACK_ID,
      templateOverrides: {}
    };
  }

  function normalizePromptPackId(value) {
    const normalized = normalizeWhitespace(value);
    return normalized || DEFAULT_PROMPT_PACK_ID;
  }

  function normalizeTemplateOverrideText(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n");
    return normalizeWhitespace(text) ? text : "";
  }

  function normalizePromptPackSettings(settings) {
    const merged = {
      ...defaultPromptPackSettings(),
      ...(settings || {})
    };
    const templateOverrides = {};
    const rawOverrides = merged.templateOverrides && typeof merged.templateOverrides === "object"
      ? merged.templateOverrides
      : {};
    for (const promptKey of PROMPT_OVERRIDE_KEYS) {
      const normalized = normalizeTemplateOverrideText(rawOverrides[promptKey]);
      if (normalized) {
        templateOverrides[promptKey] = normalized;
      }
    }
    return {
      activePackId: normalizePromptPackId(merged.activePackId),
      templateOverrides
    };
  }

  function builtInAssetMap() {
    const assets = global.__LUMI_PROMPT_PACK_ASSETS__;
    return assets && typeof assets === "object" ? assets : null;
  }

  async function readAssetText(assetPath) {
    const assets = builtInAssetMap();
    if (assets && Object.prototype.hasOwnProperty.call(assets, assetPath)) {
      return String(assets[assetPath] || "");
    }
    if (typeof fetch !== "function") {
      throw new Error(`Prompt asset loader is unavailable for ${assetPath}.`);
    }
    const assetUrl = global.chrome?.runtime?.getURL ? global.chrome.runtime.getURL(assetPath) : assetPath;
    const response = await fetch(assetUrl);
    if (!response?.ok) {
      throw new Error(`Unable to load prompt asset: ${assetPath}`);
    }
    return response.text();
  }

  async function readJsonAsset(assetPath) {
    const rawText = await readAssetText(assetPath);
    return JSON.parse(rawText);
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Prompt pack manifest must be an object.");
    }
    if (normalizePromptPackId(manifest.pack_id) !== DEFAULT_PROMPT_PACK_ID) {
      throw new Error(`Unsupported prompt pack id: ${manifest.pack_id || "unknown"}.`);
    }
    if (Number(manifest.app_compat_version) !== APP_COMPAT_VERSION) {
      throw new Error(`Unsupported prompt pack app compatibility version: ${manifest.app_compat_version || "unknown"}.`);
    }
    const prompts = manifest.prompts && typeof manifest.prompts === "object" ? manifest.prompts : null;
    if (!prompts) {
      throw new Error("Prompt pack manifest is missing prompts.");
    }
    for (const promptKey of PROMPT_OVERRIDE_KEYS) {
      const entry = prompts[promptKey];
      if (!entry?.template_path || !entry?.contract_path) {
        throw new Error(`Prompt pack manifest is missing template or contract path for ${promptKey}.`);
      }
    }
  }

  function validateContract(promptKey, contract) {
    if (!contract || typeof contract !== "object") {
      throw new Error(`Prompt contract for ${promptKey} must be an object.`);
    }
    if (!normalizeWhitespace(contract.contract_id)) {
      throw new Error(`Prompt contract for ${promptKey} is missing contract_id.`);
    }
  }

  async function loadPromptEntry(packId, promptKey, entry) {
    const basePath = `prompt-packs/${packId}`;
    const [template, contract] = await Promise.all([
      readAssetText(`${basePath}/${entry.template_path}`),
      readJsonAsset(`${basePath}/${entry.contract_path}`)
    ]);
    validateContract(promptKey, contract);
    return {
      promptKey,
      label: normalizeWhitespace(entry.label) || BUILT_IN_PROMPT_LABELS[promptKey] || promptKey,
      template,
      contract
    };
  }

  async function loadBuiltInPromptPack(packId = DEFAULT_PROMPT_PACK_ID) {
    const normalizedPackId = normalizePromptPackId(packId);
    if (packCache.has(normalizedPackId)) {
      return packCache.get(normalizedPackId);
    }
    if (packLoadPromises.has(normalizedPackId)) {
      return packLoadPromises.get(normalizedPackId);
    }
    const loadPromise = (async () => {
      const manifestPath = `prompt-packs/${normalizedPackId}/prompt-pack.json`;
      const manifest = await readJsonAsset(manifestPath);
      validateManifest(manifest);
      const prompts = {};
      for (const promptKey of PROMPT_OVERRIDE_KEYS) {
        prompts[promptKey] = await loadPromptEntry(normalizedPackId, promptKey, manifest.prompts[promptKey]);
      }
      const pack = { manifest, prompts };
      packCache.set(normalizedPackId, pack);
      packLoadPromises.delete(normalizedPackId);
      return pack;
    })().catch((error) => {
      packLoadPromises.delete(normalizedPackId);
      throw error;
    });
    packLoadPromises.set(normalizedPackId, loadPromise);
    return loadPromise;
  }

  async function ensureReady(settings) {
    const normalizedSettings = normalizePromptPackSettings(settings);
    return loadBuiltInPromptPack(normalizedSettings.activePackId);
  }

  function getCachedBuiltInPromptPack(packId = DEFAULT_PROMPT_PACK_ID) {
    return packCache.get(normalizePromptPackId(packId)) || null;
  }

  function requireCachedPack(settings) {
    const normalizedSettings = normalizePromptPackSettings(settings);
    const pack = getCachedBuiltInPromptPack(normalizedSettings.activePackId);
    if (!pack) {
      throw new Error(`Prompt pack ${normalizedSettings.activePackId} is not loaded yet.`);
    }
    return {
      pack,
      settings: normalizedSettings
    };
  }

  function getPromptEntry(promptKey, settings) {
    const { pack } = requireCachedPack(settings);
    const entry = pack.prompts[promptKey];
    if (!entry) {
      throw new Error(`Unknown prompt key: ${promptKey}`);
    }
    return entry;
  }

  function getBuiltInContract(promptKey, settings) {
    return getPromptEntry(promptKey, settings).contract;
  }

  function getBuiltInTemplate(promptKey, settings) {
    const normalizedSettings = normalizePromptPackSettings(settings);
    const override = normalizedSettings.templateOverrides[promptKey];
    if (override) {
      return override;
    }
    return getPromptEntry(promptKey, normalizedSettings).template;
  }

  function getBuiltInPromptSource(promptKey, settings) {
    const normalizedSettings = normalizePromptPackSettings(settings);
    const override = normalizedSettings.templateOverrides[promptKey];
    return {
      promptKey,
      source: override ? "override" : "built_in",
      template: override || getPromptEntry(promptKey, normalizedSettings).template,
      label: BUILT_IN_PROMPT_LABELS[promptKey] || promptKey
    };
  }

  function listBuiltInPromptChoices() {
    return VISIBLE_PROMPT_TEMPLATE_KEYS.map((promptKey) => ({
      key: promptKey,
      label: BUILT_IN_PROMPT_LABELS[promptKey] || promptKey
    }));
  }

  function applyTemplate(template, replacements) {
    const compiled = String(template || "").replace(/{{([a-z0-9_]+)}}/gi, (_match, key) => {
      if (!Object.prototype.hasOwnProperty.call(replacements || {}, key)) {
        return `{{${key}}}`;
      }
      return String(replacements[key] ?? "");
    });
    const unresolved = compiled.match(/{{[a-z0-9_]+}}/gi);
    if (unresolved?.length) {
      throw new Error(`Unresolved prompt placeholders: ${Array.from(new Set(unresolved)).join(", ")}`);
    }
    return compiled;
  }

  global.LumiPromptPackRuntime = {
    APP_COMPAT_VERSION,
    DEFAULT_PROMPT_PACK_ID,
    PROMPT_OVERRIDE_KEYS,
    VISIBLE_PROMPT_TEMPLATE_KEYS,
    applyTemplate,
    defaultPromptPackSettings,
    ensureReady,
    getBuiltInContract,
    getBuiltInPromptSource,
    getBuiltInTemplate,
    getCachedBuiltInPromptPack,
    listBuiltInPromptChoices,
    loadBuiltInPromptPack,
    normalizePromptPackId,
    normalizePromptPackSettings,
    normalizeTemplateOverrideText
  };
})(globalThis);
