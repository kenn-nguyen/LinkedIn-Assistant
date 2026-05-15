(function initLinkedInJobExtraction() {
  const shared = globalThis.LinkedInAssistantShared || {};
  const normalizeWhitespace = shared.normalizeWhitespace || ((value) => String(value || "").replace(/\s+/g, " ").trim());

  const JOB_DESCRIPTION_SELECTORS = [
    '[data-testid="expandable-text-box"]',
    '[data-test-id="job-details-description"]',
    ".jobs-description-content__text",
    ".jobs-description",
    ".jobs-box__html-content",
    ".show-more-less-html__markup"
  ];

  const FIELD_SELECTORS = {
    title: [
      '[data-testid="job-title"]',
      '[data-test-id="job-details-job-title"]',
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      ".top-card-layout__title",
      "main h1",
      "h1"
    ],
    company: [
      '[data-testid="hiring-company"]',
      '[data-test-id="job-details-company-name"]',
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      ".topcard__org-name-link",
      'main a[href*="/company/"]'
    ],
    location: [
      '[data-testid="job-location"]',
      '[data-test-id="job-details-location"]',
      ".jobs-unified-top-card__bullet",
      ".topcard__flavor--bullet",
      ".job-details-jobs-unified-top-card__primary-description-container"
    ],
    datePosted: [
      '[data-test-id="job-details-posted-date"]',
      ".posted-time-ago__text",
      'span[class*="posted-time"]',
      ".job-details-jobs-unified-top-card__tertiary-description-container"
    ]
  };

  const META_TITLE_SELECTORS = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]'
  ];

  const META_DESCRIPTION_SELECTORS = [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]'
  ];

  const JOB_PAGE_PATH_PATTERN = /^\/jobs(?:\/|$)/i;

  function absoluteUrl(href) {
    const raw = normalizeWhitespace(href || "");
    if (!raw) {
      return "";
    }
    try {
      return new URL(raw, window.location.origin).href;
    } catch (_error) {
      return raw;
    }
  }

  function currentUrl() {
    return normalizeWhitespace(window.location.href || "");
  }

  function linkedInJobIdFromUrl(href) {
    const normalized = normalizeWhitespace(href || currentUrl());
    try {
      const parsed = new URL(normalized, window.location.origin);
      const currentJobId = normalizeWhitespace(parsed.searchParams.get("currentJobId") || "");
      if (currentJobId) {
        return currentJobId;
      }
      const match = parsed.pathname.match(/\/jobs\/view\/(\d+)/i);
      return match?.[1] || "";
    } catch (_error) {
      const match = normalized.match(/\/jobs\/view\/(\d+)/i);
      return match?.[1] || "";
    }
  }

  function normalizeJobUrl(href) {
    const source = absoluteUrl(href || currentUrl());
    const jobId = linkedInJobIdFromUrl(source);
    if (!jobId) {
      return source;
    }
    try {
      const parsed = new URL(source, window.location.origin);
      return `${parsed.origin}/jobs/view/${jobId}/`;
    } catch (_error) {
      return `https://www.linkedin.com/jobs/view/${jobId}/`;
    }
  }

  function jobUrlFromId(jobId) {
    const normalizedJobId = normalizeWhitespace(jobId);
    return normalizedJobId ? `https://www.linkedin.com/jobs/view/${normalizedJobId}/` : "";
  }

  function deriveLinkedInJobUrl(doc) {
    const direct = normalizeJobUrl(currentUrl());
    if (/\/jobs\/view\/\d+\//i.test(direct)) {
      return direct;
    }
    const candidates = [
      doc.querySelector('link[rel="canonical"]'),
      doc.querySelector('a[href*="/jobs/view/"][href*="currentJobId="]'),
      doc.querySelector('a[href*="/jobs/view/"]')
    ];
    for (const candidate of candidates) {
      const normalized = normalizeJobUrl(candidate?.href || candidate?.getAttribute?.("href") || "");
      if (/\/jobs\/view\/\d+\//i.test(normalized)) {
        return normalized;
      }
    }
    return direct;
  }

  function isSupportedJobPage() {
    if (!window.location.hostname.includes("linkedin.com")) {
      return false;
    }
    const hasJobDom = Boolean(document.querySelector([
      ...FIELD_SELECTORS.title,
      ...FIELD_SELECTORS.company,
      ...JOB_DESCRIPTION_SELECTORS,
      ".jobs-details",
      ".jobs-details__main-content",
      ".jobs-search__job-details--wrapper",
      "[data-job-id]"
    ].join(",")));
    if (/^\/jobs\/view\/\d+/i.test(window.location.pathname)) {
      return true;
    }
    if (hasJobDom) {
      return true;
    }
    if (!JOB_PAGE_PATH_PATTERN.test(window.location.pathname)) {
      return false;
    }
    if (linkedInJobIdFromUrl(currentUrl())) {
      return true;
    }
    return hasJobDom;
  }

  function visibleText(node) {
    if (!node) {
      return "";
    }
    return normalizeWhitespace(node.textContent || "");
  }

  function firstMetaContentWithSource(doc, selectors) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const text = normalizeWhitespace(node?.getAttribute?.("content") || "");
      if (text) {
        return { text, source: selector };
      }
    }
    return { text: "", source: "" };
  }

  function firstTextWithSource(doc, selectors) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const text = visibleText(node);
      if (text) {
        return { text, source: selector };
      }
    }
    return { text: "", source: "" };
  }

  function firstNodeWithText(doc, selectors) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const text = visibleText(node);
      if (text) {
        return { node, text, source: selector };
      }
    }
    return { node: null, text: "", source: "" };
  }

  function firstLinkHref(doc, selectors) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const href = absoluteUrl(node?.href || node?.getAttribute?.("href") || "");
      if (href) {
        return href;
      }
    }
    return "";
  }

  function normalizeCompanyText(text) {
    return normalizeWhitespace(text)
      .replace(/\b\d[\d,]*\s+followers\b/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeComparableText(text) {
    return normalizeWhitespace(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function stripJobCardNoise(text) {
    const normalized = normalizeWhitespace(text)
      .replace(/\s*\((?:verified\s+job|promoted)\)\s*/ig, " ")
      .replace(/\bwith\s+verification\b/ig, " ");
    const noiseMatch = normalized.search(/(?:promoted|viewed|be an early applicant|you.?d be a top applicant|\d+\s+connections?\s+work\s+here)/i);
    return normalizeWhitespace(noiseMatch >= 0 ? normalized.slice(0, noiseMatch) : normalized);
  }

  function cleanJobCardLocation(text) {
    return normalizeWhitespace(text)
      .replace(/(?:promoted|viewed|be an early applicant|you.?d be a top applicant|\d+\s+connections?\s+work\s+here).*$/i, "")
      .trim();
  }

  function cleanJobMetaText(text) {
    return normalizeWhitespace(text)
      .replace(/apply(?=Promoted\b)/i, "apply · ")
      .replace(/LinkedIn(?=[A-Z])/g, "LinkedIn · ");
  }

  function parseJobPrimaryMeta(text) {
    const parts = cleanJobMetaText(text)
      .split(/\s*[·•]\s*/)
      .map(normalizeWhitespace)
      .filter(Boolean);
    const result = {
      location: "",
      datePosted: "",
      applySignal: "",
      promotionSignal: ""
    };
    parts.forEach((part) => {
      if (!result.datePosted && /\b(?:minute|hour|day|week|month|year)s?\s+ago\b/i.test(part)) {
        result.datePosted = part;
      } else if (!result.applySignal && /\b(?:clicked\s+apply|applicants?|applied)\b/i.test(part)) {
        result.applySignal = part;
      } else if (!result.promotionSignal && /\b(?:promoted|responses managed)\b/i.test(part)) {
        result.promotionSignal = part;
      } else if (!result.location) {
        result.location = part;
      } else if (/\b(?:promoted|responses managed)\b/i.test(part)) {
        result.promotionSignal = [result.promotionSignal, part].filter(Boolean).join(" · ");
      }
    });
    return result;
  }

  function splitRepeatedJobTitlePrefix(text) {
    const words = normalizeWhitespace(text).split(/\s+/).filter(Boolean);
    for (let size = Math.floor((words.length - 1) / 2); size >= 1; size -= 1) {
      const first = normalizeComparableText(words.slice(0, size).join(" "));
      const second = normalizeComparableText(words.slice(size, size * 2).join(" "));
      if (first && first === second) {
        return {
          title: normalizeWhitespace(words.slice(0, size).join(" ")),
          remainder: normalizeWhitespace(words.slice(size * 2).join(" "))
        };
      }
    }
    return { title: "", remainder: "" };
  }

  function parseCollectionJobCardText(text) {
    const cleaned = stripJobCardNoise(text);
    if (!cleaned || /^(?:more|clear|show all)$/i.test(cleaned)) {
      return { title: "", company: "", location: "" };
    }

    const [beforeLocation, ...locationParts] = cleaned.split(/\s+•\s+/);
    const repeated = splitRepeatedJobTitlePrefix(beforeLocation);
    if (!repeated.title || !repeated.remainder) {
      return { title: "", company: "", location: "" };
    }

    return {
      title: repeated.title,
      company: normalizeCompanyText(repeated.remainder),
      location: cleanJobCardLocation(locationParts.join(" • "))
    };
  }

  function extractCollectionJobCard(doc, jobId) {
    const normalizedJobId = normalizeWhitespace(jobId);
    if (!normalizedJobId) {
      return { jobId: "", title: "", company: "", location: "", source: "" };
    }
    const links = Array.from(doc.querySelectorAll('a[href*="currentJobId="], a[href*="/jobs/view/"]'));
    for (const link of links) {
      if (linkedInJobIdFromUrl(link.href || link.getAttribute?.("href") || "") !== normalizedJobId) {
        continue;
      }
      const parsed = parseCollectionJobCardText(visibleText(link));
      if (parsed.title && parsed.company) {
        return {
          jobId: normalizedJobId,
          ...parsed,
          source: "collection-job-card"
        };
      }
    }
    return { jobId: "", title: "", company: "", location: "", source: "" };
  }

  function extractCollectionJobCardByIdentity(doc, title, company) {
    const comparableTitle = normalizeComparableText(title);
    const comparableCompany = normalizeComparableText(company);
    if (!comparableTitle || !comparableCompany) {
      return { jobId: "", title: "", company: "", location: "", source: "" };
    }
    const cards = Array.from(doc.querySelectorAll("[data-job-id]"));
    for (const card of cards) {
      const parsed = parseCollectionJobCardText(visibleText(card));
      const parsedCompany = normalizeComparableText(parsed.company);
      if (
        parsed.title
        && parsed.company
        && normalizeComparableText(parsed.title) === comparableTitle
        && (parsedCompany === comparableCompany || parsedCompany.startsWith(`${comparableCompany} `))
      ) {
        return {
          jobId: normalizeWhitespace(card.getAttribute("data-job-id") || ""),
          ...parsed,
          source: "collection-job-card"
        };
      }
    }
    return { jobId: "", title: "", company: "", location: "", source: "" };
  }

  function stripLinkedInTitleSuffix(text) {
    return normalizeWhitespace(text)
      .replace(/\s*\|\s*LinkedIn\s*$/i, "")
      .replace(/\s+-\s*LinkedIn\s*$/i, "")
      .trim();
  }

  function parseTitleAndCompanyFromMetadata(text) {
    const normalized = stripLinkedInTitleSuffix(text);
    const atMatch = normalized.match(/^(.+?)\s+at\s+(.+)$/i);
    if (atMatch) {
      return {
        title: normalizeWhitespace(atMatch[1]),
        company: normalizeCompanyText(atMatch[2])
      };
    }
    const hiringMatch = normalized.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (hiringMatch) {
      return {
        title: normalizeWhitespace(hiringMatch[2]),
        company: normalizeCompanyText(hiringMatch[1])
      };
    }
    const pipeMatch = normalized.match(/^(.+?)\s+\|\s+(.+)$/i);
    if (pipeMatch) {
      return {
        title: normalizeWhitespace(pipeMatch[1]),
        company: normalizeCompanyText(pipeMatch[2])
      };
    }
    return { title: "", company: "" };
  }

  function extractMetadataHints(doc) {
    const metaTitle = firstMetaContentWithSource(doc, META_TITLE_SELECTORS);
    const titleAndCompany = parseTitleAndCompanyFromMetadata(metaTitle.text || doc.title || "");
    const description = firstMetaContentWithSource(doc, META_DESCRIPTION_SELECTORS);
    return {
      title: titleAndCompany.title,
      company: titleAndCompany.company,
      description: description.text,
      sourceFields: {
        title: titleAndCompany.title ? metaTitle.source || "document-title" : "",
        company: titleAndCompany.company ? metaTitle.source || "document-title" : "",
        description: description.source
      }
    };
  }

  function findCompanyNearTitle(doc) {
    const title = firstNodeWithText(doc, FIELD_SELECTORS.title);
    const scope = title.node?.closest?.([
      "[data-testid='job-details']",
      "[data-test-id='job-details']",
      ".job-details-jobs-unified-top-card",
      ".jobs-unified-top-card",
      "section",
      "main"
    ].join(","));
    if (!scope) {
      return { text: "", source: "" };
    }
    const company = firstTextWithSource(scope, [
      '[data-testid="hiring-company"]',
      '[data-test-id="job-details-company-name"]',
      'a[href*="/company/"]'
    ]);
    return company.text
      ? { text: normalizeCompanyText(company.text), source: `near-title:${company.source}` }
      : { text: "", source: "" };
  }

  function extractJobPostingJsonLd(doc) {
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        const flattened = entries.flatMap((entry) => Array.isArray(entry?.["@graph"]) ? entry["@graph"] : [entry]);
        const posting = flattened.find((entry) => {
          const type = entry?.["@type"];
          return Array.isArray(type) ? type.includes("JobPosting") : type === "JobPosting";
        });
        if (posting) {
          return posting;
        }
      } catch (_error) {
        // Ignore malformed structured data and use deterministic DOM selectors.
      }
    }
    return null;
  }

  function jsonLdCompanyName(jobPosting) {
    const org = jobPosting?.hiringOrganization;
    if (Array.isArray(org)) {
      return normalizeWhitespace(org.map((entry) => entry?.name).find(Boolean));
    }
    return normalizeWhitespace(org?.name || "");
  }

  function jsonLdLocation(jobPosting) {
    const location = Array.isArray(jobPosting?.jobLocation)
      ? jobPosting.jobLocation[0]
      : jobPosting?.jobLocation;
    const address = location?.address || {};
    return normalizeWhitespace([
      address.addressLocality,
      address.addressRegion,
      address.addressCountry
    ].filter(Boolean).join(", "));
  }

  function extractJobDescription(doc, jobPosting) {
    const jsonDescription = normalizeWhitespace(jobPosting?.description || "");
    if (jsonDescription) {
      return { text: jsonDescription, source: "json-ld" };
    }
    requestDescriptionExpansion(doc);
    const selectorDescription = firstTextWithSource(doc, JOB_DESCRIPTION_SELECTORS);
    if (selectorDescription.text) {
      return selectorDescription;
    }
    return extractDescriptionFromAboutSection(doc);
  }

  function extractDescriptionFromAboutSection(doc) {
    const headings = Array.from(doc.querySelectorAll("h2,h3"));
    const heading = headings.find((node) => /^about\s+the\s+job$/i.test(visibleText(node)));
    const scope = heading?.closest?.("section, article");
    if (!scope) {
      return { text: "", source: "" };
    }
    const blocks = Array.from(scope.querySelectorAll("p, li"))
      .map(visibleText)
      .filter(Boolean);
    return {
      text: normalizeWhitespace(blocks.join("\n")),
      source: blocks.length ? "about-section" : ""
    };
  }

  function requestDescriptionExpansion(doc) {
    const region = doc.querySelector('[data-testid="job-details"]')
      || doc.querySelector('[data-testid="expandable-text-box"]')?.closest("section, article, div")
      || doc.querySelector(".jobs-description")
      || null;
    if (!region) {
      return;
    }
    const scope = region;
    const controls = Array.from(scope.querySelectorAll([
      '[data-testid="expandable-text-button"]',
      'button[aria-expanded="false"]',
      "button"
    ].join(","))).filter((button) => {
      const text = normalizeWhitespace([
        button.textContent || "",
        button.getAttribute?.("aria-label") || ""
      ].join(" "));
      return /(?:see|show)\s+more/i.test(text);
    });

    controls.slice(0, 3).forEach((button) => {
      try {
        button.click();
      } catch (_error) {
        // Best effort: the next retry reads whatever LinkedIn exposes.
      }
    });
  }

  function extractJobPageContext(doc = document) {
    const jobPosting = extractJobPostingJsonLd(doc);
    const metadata = extractMetadataHints(doc);
    const title = firstTextWithSource(doc, FIELD_SELECTORS.title);
    const company = firstTextWithSource(doc, FIELD_SELECTORS.company);
    const nearbyCompany = findCompanyNearTitle(doc);
    const location = firstTextWithSource(doc, FIELD_SELECTORS.location);
    const datePosted = firstTextWithSource(doc, FIELD_SELECTORS.datePosted);
    const description = extractJobDescription(doc, jobPosting);
    const urlJobId = linkedInJobIdFromUrl(currentUrl());
    const urlCollectionCard = extractCollectionJobCard(doc, urlJobId);
    const companyUrl = firstLinkHref(doc, [
      '[data-testid="hiring-company"][href]',
      '[data-test-id="job-details-company-name"][href]',
      ".job-details-jobs-unified-top-card__company-name a[href]",
      ".jobs-unified-top-card__company-name a[href]",
      'main a[href*="/company/"]'
    ]);

    const resolvedTitle = normalizeWhitespace(jobPosting?.title || title.text || metadata.title || urlCollectionCard.title);
    const resolvedCompany = normalizeCompanyText(
      jsonLdCompanyName(jobPosting)
      || nearbyCompany.text
      || company.text
      || metadata.company
      || urlCollectionCard.company
    );
    const identityCollectionCard = extractCollectionJobCardByIdentity(doc, resolvedTitle, resolvedCompany);
    const collectionCard = urlCollectionCard.source ? urlCollectionCard : identityCollectionCard;
    const primaryMeta = parseJobPrimaryMeta(location.text || datePosted.text || "");
    const resolvedLocation = jsonLdLocation(jobPosting) || primaryMeta.location || collectionCard.location;
    const resolvedDatePosted = normalizeWhitespace(jobPosting?.datePosted || primaryMeta.datePosted || datePosted.text);
    const resolvedDescription = description.text || metadata.description;
    const jobId = urlJobId || identityCollectionCard.jobId || collectionCard.jobId || linkedInJobIdFromUrl(deriveLinkedInJobUrl(doc));
    const jobUrl = jobUrlFromId(jobId) || deriveLinkedInJobUrl(doc);
    const supported = Boolean(resolvedTitle && resolvedCompany);

    return {
      supported,
      pageType: "linkedin-job",
      pageUrl: jobUrl || currentUrl(),
      title: document.title,
      reason: supported ? "" : "Loading job...",
      job: {
        jobId,
        title: resolvedTitle,
        company: resolvedCompany,
        companyUrl,
        location: resolvedLocation,
        datePosted: resolvedDatePosted,
        applySignal: primaryMeta.applySignal,
        promotionSignal: primaryMeta.promotionSignal,
        jobUrl: jobUrl || currentUrl(),
        description: resolvedDescription,
        sourceFields: {
          title: jobPosting?.title ? "json-ld" : title.source || metadata.sourceFields.title || collectionCard.source,
          company: jsonLdCompanyName(jobPosting) ? "json-ld" : nearbyCompany.source || company.source || metadata.sourceFields.company || collectionCard.source,
          location: jsonLdLocation(jobPosting) ? "json-ld" : location.source || collectionCard.source,
          datePosted: jobPosting?.datePosted ? "json-ld" : datePosted.source,
          description: description.source || metadata.sourceFields.description
        },
        extractedAt: new Date().toISOString()
      },
      debug: {
        page_kind: "job",
        job_id_found: Boolean(jobId),
        job_title_found: Boolean(resolvedTitle),
        job_company_found: Boolean(resolvedCompany),
        job_location_found: Boolean(resolvedLocation),
        job_description_length: resolvedDescription.length,
        job_has_json_ld: Boolean(jobPosting),
        job_collection_card_found: Boolean(collectionCard.source)
      }
    };
  }

  globalThis.LinkedInAssistantJobExtraction = {
    isSupportedJobPage,
    extractJobPageContext,
    normalizeJobUrl,
    linkedInJobIdFromUrl
  };
})();
