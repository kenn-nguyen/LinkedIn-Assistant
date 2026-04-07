(function initIdentity(global) {
  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeUrl(value) {
    const text = normalizeWhitespace(value);
    if (!text) {
      return "";
    }
    try {
      return new URL(text).toString();
    } catch (_error) {
      return text;
    }
  }

  function slugify(value) {
    return normalizeWhitespace(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function uniqueStrings(values) {
    const seen = new Set();
    return (values || [])
      .map(normalizeWhitespace)
      .filter(Boolean)
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function firstNameFromFullName(fullName) {
    const normalized = normalizeWhitespace(fullName);
    if (!normalized) {
      return "";
    }
    return normalized.split(" ")[0];
  }

  function normalizeLinkedInProfileUrl(value) {
    const text = normalizeUrl(value);
    if (!text) {
      return "";
    }
    try {
      const url = new URL(text);
      if (!/linkedin\.com$/i.test(url.hostname) && !/linkedin\.com$/i.test(url.hostname.split(".").slice(-2).join("."))) {
        return text;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const profileIndex = parts.indexOf("in");
      if (profileIndex >= 0 && parts[profileIndex + 1]) {
        let slug = parts[profileIndex + 1];
        try {
          slug = decodeURIComponent(slug);
        } catch (_error) {
          // Keep the raw slug when decoding fails.
        }
        return `${url.origin}/in/${slug}/`;
      }
      return `${url.origin}${url.pathname}`;
    } catch (_error) {
      return text;
    }
  }

  function personIdFromProfileUrl(profileUrl, fallbackName) {
    const normalizedProfileUrl = normalizeLinkedInProfileUrl(profileUrl);
    if (normalizedProfileUrl) {
      try {
        const url = new URL(normalizedProfileUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        const profileIndex = parts.indexOf("in");
        if (profileIndex >= 0 && parts[profileIndex + 1]) {
          let slug = parts[profileIndex + 1];
          try {
            slug = decodeURIComponent(slug);
          } catch (_error) {
            // Keep the raw slug when decoding fails.
          }
          return `li:${slugify(slug)}`;
        }
      } catch (_error) {
        // Fall through to fallback name.
      }
    }

    const slug = slugify(fallbackName);
    return slug ? `name:${slug}` : "";
  }

  function linkedInProfileAlias(profileUrl) {
    const normalizedProfileUrl = normalizeLinkedInProfileUrl(profileUrl);
    return normalizedProfileUrl ? normalizedProfileUrl.toLowerCase() : "";
  }

  function isOpaqueLinkedInSlugValue(slug) {
    const normalized = normalizeWhitespace(slug);
    if (!normalized) {
      return false;
    }
    return /^ACo/i.test(normalized)
      || /[A-Z]/.test(normalized)
      || (!normalized.includes("-") && normalized.length > 20);
  }

  function isOpaqueLinkedInPersonId(value) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    return normalized.startsWith("li:") && isOpaqueLinkedInSlugValue(normalized.slice(3));
  }

  function defaultIdentity(overrides) {
    return {
      personId: "",
      fullName: "",
      firstName: "",
      profileUrl: "",
      primaryLinkedInMemberUrl: "",
      publicProfileUrl: "",
      knownProfileUrls: [],
      normalizedName: "",
      identityStatus: "provisional",
      identityConfidence: "low",
      messagingThreadUrl: "",
      aliases: [],
      ...(overrides || {})
    };
  }

  function getIdentity(personRecord) {
    return defaultIdentity(personRecord?.identity || {
      personId: personRecord?.personId,
      fullName: personRecord?.fullName,
      firstName: personRecord?.firstName,
      profileUrl: personRecord?.profileUrl,
      messagingThreadUrl: personRecord?.messagingThreadUrl
    });
  }

  function mergeIdentity(existingRecord, incomingRecord, mergedRecord) {
    const existingProfileUrl = normalizeLinkedInProfileUrl(existingRecord?.identity?.profileUrl || existingRecord?.profileUrl);
    const incomingProfileUrl = normalizeLinkedInProfileUrl(incomingRecord?.identity?.profileUrl || incomingRecord?.profileUrl);
    const mergedProfileUrl = normalizeLinkedInProfileUrl(mergedRecord?.identity?.profileUrl || mergedRecord?.profileUrl);
    const explicitPrimaryLinkedInMemberUrl = normalizeLinkedInProfileUrl(
      mergedRecord?.identity?.primaryLinkedInMemberUrl
      || incomingRecord?.identity?.primaryLinkedInMemberUrl
      || existingRecord?.identity?.primaryLinkedInMemberUrl
    );
    const explicitPublicProfileUrl = normalizeLinkedInProfileUrl(
      mergedRecord?.identity?.publicProfileUrl
      || incomingRecord?.identity?.publicProfileUrl
      || existingRecord?.identity?.publicProfileUrl
    );
    const allKnownProfileUrls = uniqueStrings([
      ...(existingRecord?.identity?.knownProfileUrls || []),
      ...(incomingRecord?.identity?.knownProfileUrls || []),
      explicitPrimaryLinkedInMemberUrl,
      explicitPublicProfileUrl,
      existingProfileUrl,
      incomingProfileUrl,
      mergedProfileUrl
    ].map(normalizeLinkedInProfileUrl).filter(Boolean));
    const opaqueProfileUrls = allKnownProfileUrls.filter((value) => {
      const slug = value ? personIdFromProfileUrl(value, "").replace(/^li:/, "") : "";
      return isOpaqueLinkedInSlugValue(slug);
    });
    const publicProfileUrls = allKnownProfileUrls.filter((value) => {
      const slug = value ? personIdFromProfileUrl(value, "").replace(/^li:/, "") : "";
      return slug && !isOpaqueLinkedInSlugValue(slug);
    });
    const primaryLinkedInMemberUrl = explicitPrimaryLinkedInMemberUrl || opaqueProfileUrls[0] || "";
    const publicProfileUrl = explicitPublicProfileUrl || publicProfileUrls[0] || "";
    const preferredProfileUrl = publicProfileUrl || primaryLinkedInMemberUrl || mergedProfileUrl || "";
    const identity = defaultIdentity({
      ...(existingRecord?.identity || {}),
      ...(incomingRecord?.identity || {}),
      personId: normalizeWhitespace(mergedRecord?.identity?.personId || mergedRecord?.personId),
      fullName: normalizeWhitespace(mergedRecord?.identity?.fullName || mergedRecord?.fullName),
      firstName: normalizeWhitespace(mergedRecord?.identity?.firstName || mergedRecord?.firstName),
      profileUrl: preferredProfileUrl,
      primaryLinkedInMemberUrl,
      publicProfileUrl,
      knownProfileUrls: allKnownProfileUrls,
      normalizedName: normalizeWhitespace(mergedRecord?.identity?.normalizedName || mergedRecord?.fullName).toLowerCase(),
      identityStatus: normalizeWhitespace(
        mergedRecord?.identity?.identityStatus
        || incomingRecord?.identity?.identityStatus
        || existingRecord?.identity?.identityStatus
        || ""
      ),
      identityConfidence: normalizeWhitespace(
        mergedRecord?.identity?.identityConfidence
        || incomingRecord?.identity?.identityConfidence
        || existingRecord?.identity?.identityConfidence
        || ""
      ),
      messagingThreadUrl: normalizeUrl(mergedRecord?.identity?.messagingThreadUrl || mergedRecord?.messagingThreadUrl),
      aliases: uniqueStrings([
        ...(existingRecord?.identity?.aliases || []),
        ...(incomingRecord?.identity?.aliases || []),
        ...allKnownProfileUrls.map(linkedInProfileAlias),
        linkedInProfileAlias(existingRecord?.identity?.primaryLinkedInMemberUrl),
        linkedInProfileAlias(existingRecord?.identity?.publicProfileUrl),
        linkedInProfileAlias(incomingRecord?.identity?.primaryLinkedInMemberUrl),
        linkedInProfileAlias(incomingRecord?.identity?.publicProfileUrl)
      ])
    });
    identity.fullName = normalizeWhitespace(identity.fullName);
    identity.firstName = normalizeWhitespace(identity.firstName) || firstNameFromFullName(identity.fullName);
    identity.normalizedName = normalizeWhitespace(identity.normalizedName || identity.fullName).toLowerCase();

    const primaryDerivedPersonId = personIdFromProfileUrl(identity.primaryLinkedInMemberUrl, identity.fullName);
    const publicDerivedPersonId = personIdFromProfileUrl(identity.publicProfileUrl, identity.fullName);
    const fallbackProfileDerivedPersonId = personIdFromProfileUrl(identity.profileUrl, identity.fullName);
    const profileDerivedPersonId = publicDerivedPersonId || primaryDerivedPersonId || fallbackProfileDerivedPersonId;
    const existingIdentityPersonId = normalizeWhitespace(identity.personId);
    const existingIdIsOpaque = isOpaqueLinkedInPersonId(existingIdentityPersonId);
    if (publicDerivedPersonId && !publicDerivedPersonId.startsWith("name:") && existingIdIsOpaque) {
      identity.personId = publicDerivedPersonId;
    } else {
      identity.personId = publicDerivedPersonId || existingIdentityPersonId || primaryDerivedPersonId || profileDerivedPersonId;
    }
    if ((!identity.personId || identity.personId.startsWith("name:")) && publicDerivedPersonId && !publicDerivedPersonId.startsWith("name:")) {
      identity.personId = publicDerivedPersonId;
    }
    if ((!identity.personId || identity.personId.startsWith("name:")) && primaryDerivedPersonId && !primaryDerivedPersonId.startsWith("name:")) {
      identity.personId = primaryDerivedPersonId;
    }
    if (!identity.personId) {
      identity.personId = personIdFromProfileUrl(identity.profileUrl, identity.fullName);
    }

    const explicitIdentityStatus = normalizeWhitespace(identity.identityStatus);
    const explicitIdentityConfidence = normalizeWhitespace(identity.identityConfidence);
    const hasStableIdentityEvidence = Boolean(identity.primaryLinkedInMemberUrl || identity.publicProfileUrl);
    if (explicitIdentityStatus === "merged") {
      identity.identityStatus = "merged";
    } else if (explicitIdentityStatus === "needs_merge_confirmation" && !hasStableIdentityEvidence) {
      identity.identityStatus = "needs_merge_confirmation";
    } else if (explicitIdentityStatus === "provisional" && !hasStableIdentityEvidence) {
      identity.identityStatus = "provisional";
    } else if (hasStableIdentityEvidence) {
      identity.identityStatus = "resolved";
    } else {
      identity.identityStatus = explicitIdentityStatus || "provisional";
    }

    if (explicitIdentityConfidence) {
      identity.identityConfidence = explicitIdentityConfidence;
    } else if (identity.primaryLinkedInMemberUrl) {
      identity.identityConfidence = "high";
    } else if (identity.publicProfileUrl) {
      identity.identityConfidence = "medium";
    } else if (identity.identityStatus === "needs_merge_confirmation") {
      identity.identityConfidence = "medium";
    } else {
      identity.identityConfidence = "low";
    }

    return identity;
  }

  global.LinkedInAssistantIdentity = {
    defaultIdentity,
    getIdentity,
    isOpaqueLinkedInPersonId,
    linkedInProfileAlias,
    mergeIdentity,
    normalizeLinkedInProfileUrl,
    personIdFromProfileUrl
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
