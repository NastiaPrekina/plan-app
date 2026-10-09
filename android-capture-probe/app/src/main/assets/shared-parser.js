(() => {
  const cleanText = (value) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  const meta = (selector) =>
    cleanText(document.querySelector(selector)?.getAttribute("content") || "");

  const text = (selector) =>
    cleanText(document.querySelector(selector)?.textContent || "");

  const parsePrice = (value) => {
    if (value == null) return null;
    const raw = String(value).replace(/\u00a0/g, " ").trim();
    const match = raw.match(/(\d[\d ]*(?:[.,]\d{1,2})?)/);
    if (!match) return null;
    const parsed = Number(match[1].replace(/ /g, "").replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 && parsed < 100000000 ? parsed : null;
  };

  const uniqueTexts = (nodes, limit) => {
    const values = [];
    for (const node of nodes) {
      const value = cleanText(node.textContent || "");
      if (!value || values.includes(value)) continue;
      values.push(value);
      if (values.length >= limit) break;
    }
    return values;
  };

  const steamAppId = () => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "store.steampowered.com") return null;
    return location.pathname.match(/^\/app\/(\d+)(?:\/|$)/i)?.[1] || null;
  };

  const steamReview = () => {
    const rows = [...document.querySelectorAll(".user_reviews_summary_row")];
    let best = null;
    for (const row of rows) {
      const tooltip = cleanText(row.getAttribute("data-tooltip-html") || row.textContent || "");
      const percentMatch =
        tooltip.match(/(\d{1,3})%\s+of\s+the\s+([\d,.\s]+)\s+user reviews/i) ||
        tooltip.match(/(\d{1,3})%/);
      if (!percentMatch) continue;
      const percent = Number(percentMatch[1]);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
      const count = percentMatch[2] ? Number(percentMatch[2].replace(/[^\d]/g, "")) : 0;
      const label = cleanText(row.querySelector(".game_review_summary")?.textContent || "");
      if (!best || count > best.count) best = { percent, count, label };
    }
    return best;
  };

  const steamGameCapture = () => {
    const appId = steamAppId();
    if (!appId) return null;

    const title =
      text(".apphub_AppName") ||
      text("#appHubAppName") ||
      meta('meta[property="og:title"]').replace(/\s+on Steam$/i, "") ||
      cleanText(document.title).replace(/\s+on Steam$/i, "");
    if (!title) return null;

    const description =
      text(".game_description_snippet") ||
      meta('meta[name="description"]') ||
      meta('meta[property="og:description"]') ||
      null;

    const headerImage = document.querySelector(".game_header_image_full");
    const imageValue =
      headerImage?.currentSrc ||
      headerImage?.src ||
      meta('meta[property="og:image"]') ||
      "";
    let imageUrl = null;
    if (imageValue) {
      try { imageUrl = new URL(imageValue, location.href).href; } catch {}
    }

    const releaseText = text(".release_date .date") || "";
    const yearMatch = releaseText.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : null;

    const genres = uniqueTexts(
      document.querySelectorAll('#genresAndManufacturer a[href*="/genre/"], .details_block a[href*="/genre/"]'),
      16,
    );
    const tags = uniqueTexts(
      document.querySelectorAll(".glance_tags.popular_tags a.app_tag, a.app_tag"),
      24,
    );

    const platforms = [];
    if (document.querySelector(".platform_img.win")) platforms.push("Windows");
    if (document.querySelector(".platform_img.mac")) platforms.push("macOS");
    if (document.querySelector(".platform_img.linux")) platforms.push("Linux");

    const featureNames = uniqueTexts(
      document.querySelectorAll(".game_area_details_specs .name, .game_area_details_specs a"),
      40,
    );
    const normalizedFeatures = featureNames.map((value) => value.toLowerCase());
    const coop = normalizedFeatures.some(
      (value) => /\bco[- ]?op\b/.test(value) || value.includes("remote play together"),
    );
    const coopModes = [];
    if (normalizedFeatures.some((value) => value.includes("online co-op"))) {
      coopModes.push("online_coop");
    }
    if (normalizedFeatures.some(
      (value) => value.includes("shared/split screen co-op") || value.includes("shared/split screen"),
    )) {
      coopModes.push("shared_split_screen");
    }
    if (normalizedFeatures.some((value) => value.includes("remote play together"))) {
      coopModes.push("remote_play_together");
    }
    if (coop && coopModes.length === 0) coopModes.push("coop");

    const review = steamReview();
    const metacriticRaw =
      text("#game_area_metascore .score") ||
      text(".game_area_metascore .score");
    const metacriticValue = Number(metacriticRaw);
    const metacriticScore =
      Number.isInteger(metacriticValue) && metacriticValue >= 0 && metacriticValue <= 100
        ? metacriticValue
        : null;

    return {
      kind: "game",
      sourceUrl: "https://store.steampowered.com/app/" + appId + "/",
      title,
      imageUrl,
      price: null,
      currency: null,
      merchant: "Steam",
      steamAppId: appId,
      description,
      year,
      genres,
      tags,
      platforms,
      coop,
      coopModes,
      steamRatingPercent: review?.percent ?? null,
      steamRatingLabel: review?.label || null,
      metacriticScore,
      capturedAt: Date.now(),
    };
  };

  const jsonLdEntities = () => {
    const entities = [];
    const append = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) append(item);
        return;
      }
      entities.push(value);
      if (Array.isArray(value["@graph"])) {
        for (const item of value["@graph"]) append(item);
      }
    };

    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        append(JSON.parse(node.textContent || "null"));
      } catch {}
    }
    return entities;
  };

  const ldTypeValues = (entity) => {
    const raw = entity?.["@type"];
    return (Array.isArray(raw) ? raw : [raw])
      .map((value) => cleanText(String(value || "")))
      .filter(Boolean);
  };

  const ldScreenEntity = () =>
    jsonLdEntities().find((entity) =>
      ldTypeValues(entity).some((value) =>
        ["Movie", "TVMovie", "TVSeries", "TVMiniSeries"].includes(value),
      ),
    ) || null;

  const screenCategoryFromEntity = (entity, fallback) => {
    const types = ldTypeValues(entity);
    if (types.some((value) => value === "TVSeries" || value === "TVMiniSeries")) {
      return "series";
    }
    if (types.some((value) => value === "Movie" || value === "TVMovie")) {
      return "movie";
    }
    return fallback;
  };

  const ldImageUrl = (entity) => {
    const imageValue = (raw) => {
      if (typeof raw === "string") return cleanText(raw);
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          const candidate = imageValue(entry);
          if (candidate) return candidate;
        }
        return null;
      }
      if (!raw || typeof raw !== "object") return null;
      return (
        imageValue(raw.url)
        || imageValue(raw.contentUrl)
        || imageValue(raw.thumbnailUrl)
        || imageValue(raw["@id"])
      );
    };

    const value = imageValue(entity?.image);
    if (!value || value === "[object Object]") return null;
    try {
      const url = new URL(value, location.href);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  };

  const ldYear = (entity) => {
    const raw =
      cleanText(entity?.datePublished || "") ||
      cleanText(entity?.dateCreated || "") ||
      cleanText(entity?.copyrightYear || "");
    const match = raw.match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/);
    return match ? Number(match[1]) : null;
  };

  const ldRating = (entity) => {
    const raw = entity?.aggregateRating?.ratingValue;
    if (raw == null || (typeof raw === "string" && !raw.trim())) return null;
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    return Number.isFinite(value) && value > 0 && value <= 10 ? value : null;
  };

  const ldGenres = (entity) => {
    const raw = entity?.genre;
    const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
    return values
      .map((value) => cleanText(String(value || "")))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 16);
  };

  const ldCountry = (entity) => {
    const raw = entity?.countryOfOrigin ?? entity?.country;
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const names = values
      .map((value) =>
        typeof value === "string"
          ? cleanText(value)
          : cleanText(value?.name || value?.alternateName || ""),
      )
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 4);
    return names.length ? names.join(", ") : null;
  };


  const ldBookEntity = () =>
    jsonLdEntities().find((entity) =>
      ldTypeValues(entity).some((value) =>
        ["Book", "Audiobook", "AudioBook"].includes(value),
      ),
    ) || null;

  const ldPeopleNames = (raw, limit = 8) => {
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return values
      .map((value) =>
        typeof value === "string"
          ? cleanText(value)
          : cleanText(value?.name || value?.alternateName || ""),
      )
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, limit);
  };

    const placeProviderHost = () =>
    location.hostname.toLowerCase().replace(/^www\./, "");

  const yandexMapsHost = (host) =>
    /^(?:[^.]+\.)?yandex\.(?:ru|com|kz|by|uz|com\.tr)$/.test(host);

  const googleMapsHost = (host) =>
    host === "maps.google.com" ||
    /^(?:(?:www|maps)\.)?google\.[a-z.]{2,16}$/.test(host);

  const tripadvisorHost = (host) =>
    /^(?:[^.]+\.)?tripadvisor\.[a-z.]{2,16}$/.test(host);

  const yandexPlaceExternalId = (url) => {
    const orgPath =
      url.pathname.match(
        /^\/maps\/(?:[^/]+\/)?org\/(?:[^/]+\/)?(\d+)(?:\/|$)/i,
      )?.[1];
    if (orgPath) return orgPath;
    const mapsOrgPath =
      url.pathname.match(/^\/mapsorg\/(\d+)(?:\/|$)/i)?.[1];
    if (mapsOrgPath) return mapsOrgPath;
    const oid = cleanText(url.searchParams.get("oid") || "");
    return /^\d+$/.test(oid) ? oid : null;
  };

  const stablePlaceHash = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };

  const stableGoogleMapsUrl = () => {
    const url = new URL(location.href);
    for (const key of ["entry", "g_ep", "hl", "authuser", "layer"]) {
      url.searchParams.delete(key);
    }
    url.hash = "";
    return url;
  };

  const googlePlaceExternalId = (url) => {
    for (const key of ["query_place_id", "place_id", "cid"]) {
      const value = cleanText(url.searchParams.get(key) || "");
      if (value) return value;
    }
    let decoded = url.href;
    try { decoded = decodeURIComponent(decoded); } catch {}
    const dataId = decoded.match(/!1s([^!/?#]+)/)?.[1];
    return dataId || ("url_" + stablePlaceHash(url.href));
  };

  const yandexVisibleTitle = () =>
    cleanText(
      text("h1.orgpage-header-view__header")
      || text('[class*="business-card-title-view__title"]')
      || text('[class*="card-title-view__title"]')
      || text("h1")
      || "",
    );

  const yandexExternalIdFromDom = (exactOnly = false) => {
    const title = yandexVisibleTitle().toLowerCase();
    const selectors = [
      'a[href*="/maps/org/"]',
      'a[href*="/org/"]',
      'a[href*="/mapsorg/"]',
      'a[href*="oid="]',
    ];
    const candidates = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const href = node?.href || node?.getAttribute?.("href") || "";
        if (!href) continue;
        try {
          const url = new URL(href, location.href);
          const externalId = yandexPlaceExternalId(url);
          if (!externalId) continue;
          const label = cleanText(node?.textContent || node?.getAttribute?.("aria-label") || "").toLowerCase();
          candidates.push({ externalId, label });
        } catch {}
      }
    }
    const exact = title
      ? candidates.find((candidate) =>
          candidate.label === title
          || candidate.label.startsWith(title + " ")
          || candidate.label.includes(title),
        )
      : null;
    return exact?.externalId || (exactOnly ? null : candidates[0]?.externalId || null);
  };

  const yandexExternalIdFromAttributes = () => {
    const selectors = [
      '[data-oid]',
      '[data-business-id]',
      '[data-object-id]',
      '[data-entity-id]',
      '[data-id]',
      '[data-uri*="oid"]',
    ];
    const attributes = [
      "data-oid",
      "data-business-id",
      "data-object-id",
      "data-entity-id",
      "data-id",
      "data-uri",
      "href",
    ];
    const titleNode =
      document.querySelector("h1.orgpage-header-view__header")
      || document.querySelector('[class*="business-card-title-view__title"]')
      || document.querySelector('[class*="card-title-view__title"]')
      || document.querySelector("h1");
    const roots = [];
    if (titleNode) {
      roots.push(titleNode);
      let parent = titleNode.parentElement;
      for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
        roots.push(parent);
      }
    }
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) roots.push(node);
    }

    for (const node of roots) {
      for (const name of attributes) {
        const raw = cleanText(node?.getAttribute?.(name) || "");
        if (!raw) continue;
        if (/^\d{6,}$/.test(raw)) return raw;
        const match =
          raw.match(/(?:^|[?&])oid=(\d{6,})(?:[&#]|$)/i)
          || raw.match(/(?:\/org\/[^/?#]+\/|\/mapsorg\/)(\d{6,})(?:[/?#]|$)/i)
          || raw.match(/(?:business|object|entity)[^0-9]{0,20}(\d{6,})/i);
        if (match?.[1]) return match[1];
      }
    }
    return null;
  };

  const yandexExternalIdFromState = () => {
    const title = yandexVisibleTitle().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
    if (!title) return null;
    const business = yandexStateBusinesses().find((candidate) => {
      const value = cleanText(candidate?.title || candidate?.shortTitle || "")
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е");
      return value === title;
    });
    const id = cleanText(String(business?.id || ""));
    return /^\d+$/.test(id) ? id : null;
  };

  const shortcutPrefersVisiblePlaceIdentity =
    typeof __paShortcutPlaceCapture !== "undefined"
    && __paShortcutPlaceCapture === true;

  const placeSource = () => {
    const host = placeProviderHost();

    if (yandexMapsHost(host)) {
      const url = new URL(location.href);
      const urlExternalId = yandexPlaceExternalId(url);
      const visibleExternalId =
        yandexExternalIdFromState()
        || yandexExternalIdFromDom(true)
        || yandexExternalIdFromAttributes();
      const externalId =
        shortcutPrefersVisiblePlaceIdentity
          ? (
              visibleExternalId
              || urlExternalId
              || yandexExternalIdFromDom()
            )
          : (
              urlExternalId
              || yandexExternalIdFromDom()
              || yandexExternalIdFromAttributes()
              || yandexExternalIdFromState()
            );
      if (!externalId) return null;
      const canonical = new URL(url.origin + "/maps/org/" + externalId + "/");
      return { provider: "yandex_maps", externalId, sourceUrl: canonical.href };
    }

    if (googleMapsHost(host) && location.pathname.startsWith("/maps")) {
      const url = stableGoogleMapsUrl();
      const hasPlaceIdentity = (candidate) => {
        if (/\/maps\/place\//i.test(candidate.pathname)) return true;
        if (
          candidate.searchParams.get("query_place_id")
          || candidate.searchParams.get("place_id")
          || candidate.searchParams.get("cid")
        ) return true;
        let decoded = candidate.href;
        try { decoded = decodeURIComponent(decoded); } catch {}
        return /!1s[^!/?#]+/.test(decoded);
      };

      if (hasPlaceIdentity(url)) {
        return {
          provider: "google_maps",
          externalId: googlePlaceExternalId(url),
          sourceUrl: url.href,
        };
      }

      const root = googleSelectedCardRoot();
      const heading =
        root?.querySelector?.("h1.DUwDvf")
        || root?.querySelector?.("h1")
        || document.querySelector("h1.DUwDvf")
        || document.querySelector("h1");
      const visibleTitle = cleanText(heading?.textContent || "").toLowerCase();
      const candidates = [];
      const seen = new Set();

      for (const scope of [root, document]) {
        for (const node of scope?.querySelectorAll?.(
          'a[href*="/maps/"], a[href*="query_place_id="], a[href*="place_id="], a[href*="cid="]',
        ) || []) {
          const href = node?.href || node?.getAttribute?.("href") || "";
          if (!href) continue;
          try {
            const candidate = new URL(href, location.href);
            const candidateHost = candidate.hostname.toLowerCase().replace(/^www\./, "");
            if (!googleMapsHost(candidateHost)) continue;
            if (!candidate.pathname.startsWith("/maps") || !hasPlaceIdentity(candidate)) continue;

            for (const key of ["entry", "g_ep", "hl", "authuser", "layer"]) {
              candidate.searchParams.delete(key);
            }
            candidate.hash = "";
            if (seen.has(candidate.href)) continue;
            seen.add(candidate.href);

            const label = cleanText(
              node?.textContent
              || node?.getAttribute?.("aria-label")
              || node?.getAttribute?.("title")
              || "",
            ).toLowerCase();
            candidates.push({ url: candidate, label, inCard: scope === root });
          } catch {}
        }
      }

      const selected =
        candidates.find((candidate) =>
          candidate.inCard
          && visibleTitle
          && (
            candidate.label === visibleTitle
            || candidate.label.startsWith(visibleTitle + " ")
            || candidate.label.includes(visibleTitle)
          ),
        )
        || candidates.find((candidate) => candidate.inCard)
        || candidates.find((candidate) =>
          visibleTitle
          && (
            candidate.label === visibleTitle
            || candidate.label.startsWith(visibleTitle + " ")
            || candidate.label.includes(visibleTitle)
          ),
        );

      if (!selected) return null;
      return {
        provider: "google_maps",
        externalId: googlePlaceExternalId(selected.url),
        sourceUrl: selected.url.href,
      };
    }

    if (tripadvisorHost(host) && /\/Restaurant_Review-/i.test(location.pathname)) {
      const match = location.pathname.match(/[-/]d(\d+)(?:[-/]|$)/i);
      if (!match) return null;
      const url = new URL(location.href);
      url.search = "";
      url.hash = "";
      return { provider: "tripadvisor", externalId: match[1], sourceUrl: url.href };
    }

    if (host === "restoclub.ru") {
      const match = location.pathname.match(/^\/([^/]+)\/place\/([^/]+)\/?$/i);
      if (!match) return null;
      return {
        provider: "restoclub",
        externalId: (match[1] + "/place/" + match[2]).toLowerCase(),
        sourceUrl: "https://www.restoclub.ru/" + match[1] + "/place/" + match[2],
      };
    }
    return null;
  };

  const placeClassification = {"rules":[{"placeType":"coffee_shop","patterns":["coffee\\s*(?:shop|house|bar|roaster(?:y)?)","espresso\\s*bar","кофейн","кофе[-\\s]?бар","кофе\\s+с\\s+собой"]},{"placeType":"restaurant","patterns":["pizzer|pizza|пиццер|пицца","sushi|суши","burger|бургер","fast\\s*food|фастфуд|быстр(?:ое|ого)\\s+питан","food\\s*court|фуд[-\\s]*корт","canteen|diner|eatery","steak\\s*house|steakhouse|стейк[-\\s]*хаус","grill|гриль","kebab|кебаб|doner|донер","shawarma|шаурм|шаверм","food\\s*truck|фудтрак|street\\s*food|стритфуд","taqueria|такери","poke|поке","фалафель","блинн","ramen|рамен","noodle|лапшич","dumpling|пельмен","хинкал","чебуреч","шашлыч","столов","кулинар","закусоч","чайхан","трактир","корчм","харчев","таверн"]},{"placeType":"bar","patterns":["gastropub|гастропаб|гастробар","hookah\\s*(?:bar|lounge)|кальянн","tap\\s*room|taproom","beer\\s*(?:bar|hall)|пивн","wine\\s*bar|винн(?:ый|ая)\\s+бар","cocktail\\s*bar|коктейльн(?:ый|ая)\\s+бар","brewery|пивовар","winery|винодель","distillery","рюмоч","(^|[^a-zа-яё])(bar|pub|бар|паб)([^a-zа-яё]|$)"]},{"placeType":"cafe","patterns":["bakery|пекар","булоч","patisserie|кондитер","confectionery","cake\\s*(?:shop|store)|торт(?:ы|ов|овый|овая)?","sweet\\s*(?:shop|store)|магазин\\s+(?:тортов|десерт(?:ов)?|сладост(?:ей)?)","dessert|десерт","tea\\s*(?:house|room)|чайная","ice\\s*cream|gelateria|джелатер|морожен","donut|пончиков","waffle|вафель","cafeteria|кафетер","bistro|бистро","(^|[^a-zа-яё])(cafe|café|кафе)([^a-zа-яё]|$)"]},{"placeType":"restaurant","patterns":["restaurant|ресторан","food\\s*hall|гастромаркет"]}],"nonFoodPatterns":["(^|[^a-zа-яё])(museum|музей)([^a-zа-яё]|$)","shopping\\s*(?:center|centre|mall)|торгов(?:ый|ого)\\s+центр|торговый\\s+комплекс","(^|[^a-zа-яё])(store|shop|магазин)([^a-zа-яё]|$)","(^|[^a-zа-яё])(hotel|отель|гостиниц)([^a-zа-яё]|$)","(^|[^a-zа-яё])(park|парк)([^a-zа-яё]|$)","pharmacy|аптек","beauty\\s*salon|салон\\s+красот","movie\\s*theater|cinema|кинотеатр","tourist\\s*attraction|достопримечатель","(^|[^a-zа-яё])(zoo|зоопарк)([^a-zа-яё]|$)","hospital|больниц|клиник","school|university|школ|университет","sports?\\s*(?:center|centre|club)|спорт(?:ивн)?(?:ый|ого)\\s+(?:центр|клуб)","car\\s*(?:dealer|wash|service)|автосалон|автомойк|автосервис"],"foodSchemaTypes":["Restaurant","CafeOrCoffeeShop","BarOrPub","Bakery","FastFoodRestaurant","FoodEstablishment","IceCreamShop","Brewery","Winery","Distillery"],"serviceSignals":[{"pattern":"(?:кухня|cuisine)\\s*:","weight":2},{"pattern":"средний\\s+чек|average\\s+check|price\\s+per\\s+person","weight":2},{"pattern":"забронировать\\s+стол|брон(?:ь|ировать)\\s+стол|table\\s+reservation|reserve\\s+a\\s+table","weight":2},{"pattern":"(^|[^a-zа-яё])(menu|меню)([^a-zа-яё]|$)","weight":1},{"pattern":"dine[-\\s]?in|takeaway|takeout|еда\\s+навынос|можно\\s+с\\s+собой","weight":1},{"pattern":"food\\s+delivery|доставка\\s+еды","weight":1},{"pattern":"breakfast|brunch|business\\s+lunch|завтрак|бранч|бизнес[-\\s]?ланч","weight":1}],"serviceThreshold":4,"nonFoodSchemaTypes":["Museum","Store","ShoppingCenter","TouristAttraction","LandmarksOrHistoricalBuildings","Hotel","LodgingBusiness","Park","Zoo","MovieTheater","PerformingArtsTheater","Hospital","Pharmacy","School","University","SportsActivityLocation","HealthAndBeautyBusiness","AutomotiveBusiness"]};
  const placeCategoryRules = placeClassification.rules;
  const placeNonFoodCategoryPatterns = placeClassification.nonFoodPatterns;
  const placeFoodSchemaTypes = new Set(placeClassification.foodSchemaTypes);
  const placeNonFoodSchemaTypes = new Set(placeClassification.nonFoodSchemaTypes);
  const placeServiceSignals = placeClassification.serviceSignals;
  const placeServiceThreshold = placeClassification.serviceThreshold;

  const placeTypeFromText = (value) => {
    const normalized = cleanText(value || "").toLowerCase();
    if (!normalized) return null;
    for (const rule of placeCategoryRules) {
      if (rule.patterns.some((pattern) => new RegExp(pattern, "i").test(normalized))) {
        return rule.placeType;
      }
    }
    return null;
  };

  const isNonFoodCategoryText = (value) => {
    const normalized = cleanText(value || "").toLowerCase();
    if (!normalized) return false;
    return placeNonFoodCategoryPatterns.some((pattern) =>
      new RegExp(pattern, "i").test(normalized),
    );
  };

  const entityHasFoodSignals = (entity) => {
    if (!entity || typeof entity !== "object") return false;
    const types = ldTypeValues(entity);
    if (types.some((value) => placeFoodSchemaTypes.has(value))) return true;
    if (types.some((value) => placeNonFoodSchemaTypes.has(value))) return false;

    const categoryText = cleanText(
      typeof entity.category === "string"
        ? entity.category
        : typeof entity.additionalType === "string"
          ? entity.additionalType
          : "",
    );
    if (placeTypeFromText(categoryText)) return true;

    const cuisine = entity.servesCuisine;
    const hasCuisine =
      typeof cuisine === "string"
        ? Boolean(cleanText(cuisine))
        : Array.isArray(cuisine) && cuisine.some((value) => Boolean(cleanText(String(value || ""))));
    const menu = entity.menu || entity.hasMenu;
    return hasCuisine || Boolean(menu);
  };

  const ldFoodPlaceEntity = () =>
    jsonLdEntities().find((entity) => entityHasFoodSignals(entity)) || null;

  const ldNonFoodPlaceEntity = () =>
    jsonLdEntities().find((entity) => {
      const types = ldTypeValues(entity);
      return (
        types.some((value) => placeNonFoodSchemaTypes.has(value))
        && !entityHasFoodSignals(entity)
      );
    }) || null;

  const placeTypeFromEntity = (entity) => {
    if (!entity) return null;
    const types = ldTypeValues(entity);
    if (types.includes("CafeOrCoffeeShop")) return "coffee_shop";
    if (
      types.includes("BarOrPub")
      || types.includes("Brewery")
      || types.includes("Winery")
      || types.includes("Distillery")
    ) return "bar";
    if (types.includes("Bakery") || types.includes("IceCreamShop")) return "cafe";
    if (
      types.includes("Restaurant")
      || types.includes("FastFoodRestaurant")
      || types.includes("FoodEstablishment")
    ) return "restaurant";

    const categoryText = cleanText(
      typeof entity.category === "string"
        ? entity.category
        : typeof entity.additionalType === "string"
          ? entity.additionalType
          : "",
    );
    return placeTypeFromText(categoryText) || (entityHasFoodSignals(entity) ? "restaurant" : null);
  };

  const placeAddressData = (entity) => {
    const raw = entity?.address;
    if (typeof raw === "string") {
      return { address: cleanText(raw) || null, city: null, region: null, country: null };
    }
    if (!raw || typeof raw !== "object") {
      return { address: null, city: null, region: null, country: null };
    }
    const countryRaw = raw.addressCountry;
    const country =
      typeof countryRaw === "string"
        ? cleanText(countryRaw)
        : cleanText(countryRaw?.name || countryRaw?.alternateName || "");
    return {
      address: cleanText(raw.streetAddress || raw.name || "") || null,
      city: cleanText(raw.addressLocality || "") || null,
      region: cleanText(raw.addressRegion || "") || null,
      country: country || null,
    };
  };

  const yandexStateBusinesses = () => {
    const businesses = [];
    const seen = new Set();
    for (const node of document.querySelectorAll('script.state-view[type="application/json"], script.state-view')) {
      let parsed = null;
      try {
        parsed = JSON.parse(node.textContent || "null");
      } catch {
        continue;
      }

      const stack = [parsed];
      let visited = 0;
      while (stack.length > 0 && visited < 12000) {
        const current = stack.pop();
        if (!current || typeof current !== "object") continue;
        visited += 1;

        if (!Array.isArray(current) && cleanText(String(current.type || "")).toLowerCase() === "business") {
          const id = cleanText(String(current.id || ""));
          if (id && !seen.has(id)) {
            seen.add(id);
            businesses.push(current);
          }
        }

        const values = Array.isArray(current) ? current : Object.values(current);
        for (const value of values) {
          if (value && typeof value === "object") stack.push(value);
        }
      }
    }
    return businesses;
  };

  const yandexStateBusiness = (externalId) => {
    const wantedId = cleanText(String(externalId || ""));
    if (!wantedId) return null;
    return yandexStateBusinesses().find(
      (business) => cleanText(String(business?.id || "")) === wantedId,
    ) || null;
  };

  const yandexStateAddress = (business) => {
    if (!business || typeof business !== "object") return "";
    const raw = business.fullAddress ?? business.address ?? business.postalAddress ?? null;
    if (typeof raw === "string") return cleanText(raw);
    if (!raw || typeof raw !== "object") return "";
    return cleanText(
      raw.fullAddress
      || raw.formattedAddress
      || raw.value
      || raw.text
      || "",
    );
  };

  const yandexStateCategories = (business) =>
    Array.isArray(business?.categories)
      ? business.categories
        .map((category) => cleanText(category?.name || category?.title || ""))
        .filter(Boolean)
        .slice(0, 12)
      : [];

  const yandexStateRating = (business) => {
    const parsed = Number(business?.ratingData?.ratingValue);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
  };

  const yandexStateCity = (business) =>
    cleanText(
      business?.addressDetails?.locality
      || business?.compositeAddress?.locality
      || "",
    );

  const yandexStateCountry = (business) =>
    cleanText(
      business?.country
      || business?.compositeAddress?.country
      || "",
    );

  const safePlaceImageUrl = (value) => {
    const raw = cleanText(String(value || "")).replace(/%s/g, "L_height");
    if (!raw) return null;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== "https:") return null;
      const normalized = url.toString();
      if (
        /(?:^|\/\/)static-maps\.yandex\./i.test(normalized)
        || /(?:^|\/\/)static-pano\.maps\.yandex\./i.test(normalized)
        || /maps\.googleapis\.com\/maps\/api\/staticmap/i.test(normalized)
      ) {
        return null;
      }
      return normalized;
    } catch {
      return null;
    }
  };

  const yandexStatePhoto = (business) => {
    if (!business || typeof business !== "object") return null;
    const photoItems = Array.isArray(business?.photos?.items)
      ? business.photos.items
      : [];
    const gallery = Array.isArray(business?.businessImages?.gallery)
      ? business.businessImages.gallery
      : [];
    const candidates = [
      business?.photos?.urlTemplate,
      ...photoItems.map((item) => item?.urlTemplate || item?.url || ""),
      business?.photoUrlTemplate,
      business?.businessImages?.cover?.urlTemplate,
      business?.businessImages?.photo?.urlTemplate,
      ...gallery.map((item) => item?.urlTemplate || item?.url || ""),
    ];
    for (const candidate of candidates) {
      const url = safePlaceImageUrl(candidate);
      if (url) return url;
    }
    return null;
  };

  const yandexFeatureValues = (raw) => {
    const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    return values
      .map((value) =>
        typeof value === "string" || typeof value === "number"
          ? cleanText(String(value))
          : cleanText(value?.name || value?.title || value?.value || ""),
      )
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index);
  };

  const yandexStateFeatureDetails = (business) => {
    const features = Array.isArray(business?.features) ? business.features : [];
    let averageCheck = null;
    let currency = null;
    const cuisines = [];
    const traits = [];
    const usefulTraitId =
      /(?:food_delivery|delivery|takeaway|coffee_to_go|breakfast|business_lunch|summer_terrace|wi_fi|car_park|parking|pet_friendly|wheelchair|hookah|live_music|music|sport|children|kids|banket|banquet)/i;

    for (const feature of features) {
      if (!feature || typeof feature !== "object") continue;
      const id = cleanText(String(feature.id || ""));
      const name = cleanText(String(feature.name || ""));
      const values = yandexFeatureValues(feature.value);

      if (id === "average_bill2" || /средн(?:ий|яя)\s+(?:чек|сч[её]т)|average\s+bill/i.test(name)) {
        const raw = values[0] || "";
        const match = raw.match(/(\d[\d\s\u00a0\u202f]*)/);
        const parsed = match ? Number(match[1].replace(/\D/g, "")) : Number.NaN;
        if (Number.isFinite(parsed) && parsed > 0 && parsed < 100000000) {
          averageCheck = parsed;
          currency = placeCurrencyFromText(raw, yandexStateCountry(business));
        }
        continue;
      }

      if (id === "type_cuisine" || /^(?:кухня|cuisine)$/i.test(name)) {
        for (const value of values) {
          if (value.length <= 60 && !cuisines.includes(value)) cuisines.push(value);
        }
        continue;
      }

      if (feature.value === true && usefulTraitId.test(id + " " + name) && name) {
        const trait = name.charAt(0).toUpperCase() + name.slice(1);
        if (trait.length <= 90 && !traits.includes(trait)) traits.push(trait);
      }
    }

    return {
      averageCheck,
      currency,
      cuisines: cuisines.slice(0, 12),
      traits: traits.slice(0, 12),
    };
  };

  const placeAddressFromSelectors = (selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const candidates = [
        node.textContent,
        node.getAttribute?.("aria-label"),
        node.getAttribute?.("data-tooltip"),
        node.getAttribute?.("title"),
        node.getAttribute?.("content"),
      ];
      for (const candidate of candidates) {
        const raw = cleanText(candidate || "");
        if (!raw) continue;
        const value = raw
          .replace(/^(?:Адрес|Address|Копировать адрес|Copy address)\s*:?\s*/i, "")
          .trim();
        if (
          !value
          || /^(?:Адрес|Address|Копировать адрес|Copy address)$/i.test(value)
          || value.length < 3
        ) continue;
        return value;
      }
    }
    return "";
  };

  const visibleMapAddress = (provider, raw) => {
    if (provider !== "google_maps" && provider !== "yandex_maps") return "";
    const lines = String(raw || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean)
      .slice(0, 90);
    const streetSignal =
      /(?:^|\s)(?:ул\.?|улица|пр\.?|проспект|переулок|пер\.?|шоссе|наб\.?|набережная|бульвар|бул\.?|пл\.?|площадь|street|st\.?|road|rd\.?|avenue|ave\.?)(?:\s|,|\.|$)/i;
    for (const line of lines) {
      if (line.length < 6 || line.length > 220) continue;
      if (!streetSignal.test(line) || !/\d/.test(line)) continue;
      if (/^(?:Маршрут|Route|Адрес|Address|Скопировать|Copy)\b/i.test(line)) continue;
      return line
        .replace(/^(?:Адрес|Address)\s*:?\s*/i, "")
        .trim();
    }
    return "";
  };

  const cityFromAddress = (value) => {
    const parts = String(value || "").split(",").map((part) => cleanText(part)).filter(Boolean);
    const blocked = /(россия|russia|kazakhstan|казахстан|беларус|belarus|узбекистан|uzbekistan|turkey|турция|czechia|czech republic|česko|чехия|poland|polska|польша)/i;
    const region = /(?:^|\s)(?:обл\.?|область|край|республик(?:а|и)?|район|district|province|state)(?:\s|$)/i;
    const subCity = /(?:^|\s)(?:микрорайон|мкр\.?|квартал|жилой\s+район)(?:\s|$)/i;
    const street = /(street|st\.?|road|rd\.?|avenue|ave\.?|просп|пр\.?|улиц|ул\.?|переул|пер\.?|набереж|наб\.?|шоссе|бульвар|boulevard|blvd|площад|дом\s*\d)/i;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index]
        .replace(/\b\d{3}\s?\d{2}\b/g, "")
        .replace(/\b\d{4,6}\b/g, "")
        .trim();
      if (!part || blocked.test(part) || region.test(part) || subCity.test(part) || street.test(part) || /^\d/.test(part) || /^#/.test(part)) continue;
      if (part.length <= 80) return part;
    }
    return null;
  };

  const placeImageFromDom = (provider) => {
    const selectors =
      provider === "google_maps"
        ? ['button[jsaction*="heroHeaderImage"] img', '.aoRNLd img', 'img[src*="googleusercontent"]']
        : provider === "yandex_maps"
          ? [
              '[class*="business-card-title-view__picture"] img',
              '[class*="orgpage-header-view"] img',
              'img[src*="avatars.mds.yandex.net/get-altay"]',
            ]
          : provider === "tripadvisor"
            ? [
                '[data-automation*="photo"] img',
                'main picture img[src*="tripadvisor"]',
                'main img[data-test-target*="photo"]',
                'main img[src*="tripadvisor"]',
              ]
            : ['main img', '[class*="gallery"] img'];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const raw = node?.currentSrc || node?.src || node?.getAttribute?.("src") || "";
      if (!raw) continue;
      try {
        const url = safePlaceImageUrl(raw);
        if (url) return url;
      } catch {}
    }
    return null;
  };

  const placeRatingFromText = (value, scale, allowLeading = false) => {
    const raw = cleanText(value || "");
    if (!raw) return null;
    const match =
      raw.match(/(?:rating|рейтинг)[^0-9]{0,30}([0-9]{1,2}(?:[.,][0-9])?)/i)
      || raw.match(/([0-9]{1,2}(?:[.,][0-9])?)\s*(?:из\s*(?:5|10)|stars?|зв[её]зд)/i)
      || (
        allowLeading
          ? raw.match(/^\s*(10(?:[.,]0)?|[0-9](?:[.,][0-9]))(?=\s*(?:\(|\[|★|☆|⭐|$))/)
          : null
      );
    if (!match) return null;
    const parsed = Number(match[1].replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= scale ? parsed : null;
  };

  const placeRatingFromVisibleCard = (raw, scale) => {
    const lines = String(raw || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean)
      .slice(0, 40);
    for (const value of lines) {
      const match = value.match(
        /^\s*(10(?:[.,]0)?|[0-9](?:[.,][0-9]))(?=\s*(?:\(|\[|★|☆|⭐|$))/,
      );
      if (!match) continue;
      const parsed = Number(match[1].replace(",", "."));
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= scale) return parsed;
    }
    return null;
  };

  const placeCurrencyFromText = (value, country) => {
    const raw = String(value || "");
    if (/(?:₸|\bKZT\b|тенге|тнг)/i.test(raw)) return "KZT";
    if (/(?:₽|\bRUB\b|руб(?:\.|ля|лей)?)/i.test(raw)) return "RUB";
    if (/(?:€|\bEUR\b)/i.test(raw)) return "EUR";
    if (/(?:\$|\bUSD\b)/i.test(raw)) return "USD";
    if (/(?:₺|\bTRY\b|лир(?:а|ы)?)/i.test(raw)) return "TRY";
    if (/(?:د\.?إ|\bAED\b)/i.test(raw)) return "AED";
    if (/(?:Kč|\bCZK\b|korun(?:a|y|u)?)/i.test(raw)) return "CZK";
    if (/(?:zł|\bPLN\b|złot(?:y|ych|e)?)/i.test(raw)) return "PLN";
    if (/(?:£|\bGBP\b)/i.test(raw)) return "GBP";
    if (/(?:\bCHF\b)/i.test(raw)) return "CHF";
    if (/(?:Ft|\bHUF\b)/i.test(raw)) return "HUF";
    const normalizedCountry = cleanText(country || "").toLowerCase();
    if (/(казахстан|kazakhstan)/i.test(normalizedCountry)) return "KZT";
    if (/(россия|russia)/i.test(normalizedCountry)) return "RUB";
    if (/(турция|turkey|türkiye)/i.test(normalizedCountry)) return "TRY";
    if (/(czech|czechia|česko|чех)/i.test(normalizedCountry)) return "CZK";
    if (/(poland|polska|польш)/i.test(normalizedCountry)) return "PLN";
    if (/(united kingdom|great britain|великобрит)/i.test(normalizedCountry)) return "GBP";
    if (/(switzerland|schweiz|suisse|швейцар)/i.test(normalizedCountry)) return "CHF";
    if (/(hungary|magyar|венгр)/i.test(normalizedCountry)) return "HUF";
    return null;
  };

  const yandexImageCategoryEvidence = () => {
    const found = [];
    for (const node of document.querySelectorAll("img[alt], img[aria-label], [role='img'][aria-label]")) {
      const value = cleanText(
        node?.getAttribute?.("alt")
        || node?.getAttribute?.("aria-label")
        || node?.alt
        || "",
      );
      if (!value) continue;

      const food = Boolean(placeTypeFromText(value));
      const blocked = isNonFoodCategoryText(value) && !food;
      if (!food && !blocked) continue;

      found.push({ value, blocked });
      if (found.length >= 8) break;
    }

    return {
      text: found.map((entry) => entry.value).join(" · "),
      nonFoodFirst: Boolean(found[0]?.blocked),
    };
  };

  const yandexBodyDetails = (raw) => {
    const lines = String(raw || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean);

    const sectionBoundary =
      /^(?:Обзор|Коротко о месте|Особенности|Features|Посещаемость(?: и график работы)?|Рейтинг|Отзывы|Фото|Как добраться|Адрес|Address|Контакты|Contacts|Время работы|Hours|Панорама|Меню|Новости|Цены|Кухня)$/i;

    const sectionAfter = (labelPattern, maxLines) => {
      const index = lines.findIndex((line) => labelPattern.test(line));
      if (index < 0) return [];
      const values = [];
      for (let offset = index + 1; offset < lines.length && values.length < maxLines; offset += 1) {
        const value = lines[offset];
        if (!value) continue;
        if (sectionBoundary.test(value)) break;
        if (/^(?:Показать полностью|Свернуть|Реклама)$/i.test(value)) continue;
        values.push(value);
      }
      return values;
    };

    const lineAfter = (labelPattern) => sectionAfter(labelPattern, 3)[0] || "";

    const featureLines = sectionAfter(/^(?:Особенности|Features)$/i, 18)
      .filter((value) => value.length <= 90)
      .filter((value) =>
        !/^(?:Кухня|Средний чек|Цены|Рейтинг|Отзывы|Фото|Меню|Новости)$/i.test(value)
        && !/(?:^|\s)(?:\+?\d[\d\s()-]{7,}|https?:\/\/|www\.)/i.test(value)
        && !/(?:\b\d+[.,]?\d*\s*(?:₽|руб|₸|тенге)|\d{1,2}:\d{2})/i.test(value),
      );

    const shortDescription = sectionAfter(/^(?:Коротко о месте|About this place)$/i, 4)
      .filter((value) => value.length >= 20 && value.length <= 500)
      .filter((value) =>
        !/(?:реклама|читать\s+\d+\s+отзыв|посмотреть\s+\d+\s+фото|построить маршрут)/i.test(value),
      )
      .slice(0, 2)
      .join(" ")
      .slice(0, 900);

    const inlineCuisine = lines
      .map((line) => line.match(/^(?:Кухня|Cuisine)\s*:\s*(.{2,300})$/i)?.[1] || "")
      .find(Boolean) || "";
    const cuisines = inlineCuisine
      .split(/[,·•]/)
      .map((value) => cleanText(value))
      .filter((value) => value && value.length <= 60)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 12);

    const featureTraits = featureLines
      .filter((value) =>
        /^(?:доставка(?: еды)?|еда навынос|бизнес-ланч|летняя веранда|wi-?fi|парковка|детская комната|спортивные трансляции|живая музыка|кальян|банкет(?:ный зал)?|завтраки?|кофе с собой|можно с животными)$/i.test(value),
      )
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 12);

    const featureText = featureLines.join(" · ");
    const foodIndex = featureLines.findIndex((value) => Boolean(placeTypeFromText(value)));
    const blockedIndex = featureLines.findIndex(
      (value) => isNonFoodCategoryText(value) && !placeTypeFromText(value),
    );

    return {
      address: lineAfter(/^(?:Адрес|Address)$/i),
      shortDescription,
      featureText,
      featureLines,
      featureTraits,
      cuisines,
      nonFoodFirst:
        blockedIndex >= 0 && (foodIndex < 0 || blockedIndex < foodIndex),
    };
  };

  const googleSelectedCardRoot = () => {
    const heading = document.querySelector("h1.DUwDvf") || document.querySelector("h1");
    if (!heading) return document.querySelector('div[role="main"]') || null;

    const main = heading?.closest?.('div[role="main"]');
    if (main) return main;

    let node = heading;
    let fallback = null;
    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      const raw = String(node?.innerText || node?.textContent || "").trim();
      if (!raw || raw.length > 18000) continue;
      fallback = node;
      const hasAddress = Boolean(
        node?.querySelector?.('[data-item-id="address"]')
        || node?.querySelector?.('[aria-label^="Address:" i]')
        || node?.querySelector?.('[aria-label^="Адрес:" i]'),
      );
      const hasRating = Boolean(
        node?.querySelector?.(".F7nice")
        || node?.querySelector?.('[role="img"][aria-label*="star" i]'),
      );
      if (raw.length >= 80 && hasAddress && hasRating) return node;
    }
    return fallback;
  };

  const googleSelectedCardText = () => {
    const root = googleSelectedCardRoot();
    return String(root?.innerText || root?.textContent || document.body?.innerText || "");
  };

  const googleAboutDescription = () => {
    const root = googleSelectedCardRoot() || document;
    const selectors = [
      'div[aria-label^="About " i] button .PYvSYb[jslog]',
      'div[aria-label^="About " i] .PYvSYb[jslog]',
      'div[aria-label^="О " i] button .PYvSYb[jslog]',
      'div[aria-label^="О " i] .PYvSYb[jslog]',
      'div[aria-label*="об этом месте" i] .PYvSYb[jslog]',
      '[data-item-id*="description" i]',
      '[data-item-id*="about" i] .PYvSYb[jslog]',
    ];
    for (const selector of selectors) {
      for (const node of root?.querySelectorAll?.(selector) || []) {
        const value = cleanText(node?.textContent || node?.getAttribute?.("aria-label") || "");
        if (
          value.length < 24
          || value.length > 1500
          || /^(?:About|Overview|Menu|Reviews|Photos|Updates|Directions|Save|Nearby|Send to phone|Share|Website|Call|Order online|Reserve|Address|Hours|Open|Closed)$/i.test(value)
          || /https?:\/\/|www\./i.test(value)
          || /^\+?[\d\s()+-]{8,}$/.test(value)
        ) {
          continue;
        }
        return value;
      }
    }
    return "";
  };

  const googleBodyDetails = (raw) => {
    const lines = String(raw || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean);

    const sectionBoundary =
      /^(?:Обзор|Overview|Описание|Description|Об этом месте|About this place|От владельца|From the business|Меню|Menu|Отзывы|Reviews|Фото|Photos|Адрес|Address|Часы работы|Hours|Популярное время|Popular times|Услуги|Services|Предложения|Offerings|Похожие места|Similar places|Информация|Information)$/i;

    const sectionAfter = (labelPattern, maxLines) => {
      const index = lines.findIndex((line) => labelPattern.test(line));
      if (index < 0) return [];
      const values = [];
      for (let offset = index + 1; offset < lines.length && values.length < maxLines; offset += 1) {
        const value = lines[offset];
        if (!value) continue;
        if (sectionBoundary.test(value)) break;
        if (/^(?:Показать полностью|Свернуть|Подробнее|More|Реклама)$/i.test(value)) continue;
        values.push(value);
      }
      return values;
    };

    const descriptionCandidate = (value) => {
      const candidate = cleanText(value || "");
      if (candidate.length < 40 || candidate.length > 900) return "";
      if (candidate.split(/\s+/).length < 6) return "";
      if (
        /(?:Google Maps|отзыв|review|похожие места|similar places|построить маршрут|directions|средн(?:ий|яя)\s+(?:чек|сч[её]т)|price\s+per\s+person|average\s+(?:check|bill))/i.test(candidate)
        || /(?:^|\s)(?:\+?\d[\d\s()-]{7,}|https?:\/\/|www\.)/i.test(candidate)
        || /(?:ул\.?|улица|проспект|пр\.?|переулок|пер\.?|шоссе|набережная|наб\.?|бульвар|street|st\.?|road|rd\.?|avenue|ave\.?).*\d/i.test(candidate)
        || /^(?:Маршрут|Сохранить|Рядом|Отправить на телефон|Поделиться|Забронировать|Заказать онлайн|Позвонить|Сайт|Route|Save|Nearby|Send to phone|Share|Reserve|Order online|Call|Website)\b/i.test(candidate)
        || /^(?:Еда в заведении|Еда навынос|Доставка|Wi-?Fi|Парковка|Завтрак|Бизнес-ланч)(?:\s*[·•,]\s*.+)?$/i.test(candidate)
      ) return "";
      return candidate;
    };

    let description = sectionAfter(
      /^(?:Описание|Description|Об этом месте|About this place|От владельца|From the business)$/i,
      4,
    )
      .map(descriptionCandidate)
      .find(Boolean) || "";

    if (!description) {
      const overviewIndex = lines.findIndex((line) => /^(?:Обзор|Overview)$/i.test(line));
      const detailBoundaryIndex = lines.findIndex((line) =>
        /^(?:Адрес|Address|Меню|Menu|Отзывы|Reviews|Фото|Photos|Информация|Information)$/i.test(line),
      );
      const start = overviewIndex >= 0 ? overviewIndex + 1 : 0;
      const end =
        detailBoundaryIndex > start
          ? detailBoundaryIndex
          : Math.min(lines.length, start + 80);
      description = lines.slice(start, end)
        .map(descriptionCandidate)
        .find(Boolean) || "";
    }

    const parseAmount = (value) => {
      const parsed = Number(String(value || "").replace(/\D/g, ""));
      return Number.isFinite(parsed) && parsed > 0 && parsed < 100000000 ? parsed : null;
    };

    const explicitPriceSource = lines.find((line) =>
      /(?:средн(?:ий|яя)\s+(?:чек|сч[её]т)|цена\s+на\s+человека|price\s+per\s+person|per\s+person|average\s+(?:check|bill|spend|price)|cena\s+(?:za|na)\s+osob[uyę])/i.test(line),
    ) || "";

    const firstSectionIndex = lines.findIndex((line) =>
      /^(?:Обзор|Overview|Меню|Menu|Отзывы|Reviews|Фото|Photos|Информация|Information)$/i.test(line),
    );
    const headerLines = lines.slice(
      0,
      firstSectionIndex >= 0 ? firstSectionIndex : Math.min(lines.length, 24),
    );
    const headerPriceSource = headerLines.find((line) =>
      /(?:₽|руб\.?|₸|\$|€|Kč|CZK|zł|PLN|£|GBP|CHF|Ft|HUF)?\s*\d[\d\s\u00a0\u202f]*\s*[–—-]\s*\d[\d\s\u00a0\u202f]*\s*(?:₽|руб\.?|₸|\$|€|Kč|CZK|zł|PLN|£|GBP|CHF|Ft|HUF)/i.test(line),
    ) || "";
    const priceSource = explicitPriceSource || headerPriceSource;

    const range = priceSource.match(
      /(\d[\d\s\u00a0\u202f]*)\s*[–—-]\s*(\d[\d\s\u00a0\u202f]*)/,
    );
    const single = priceSource.match(/(\d[\d\s\u00a0\u202f]*)/);
    const min = range ? parseAmount(range[1]) : single ? parseAmount(single[1]) : null;
    const max = range ? parseAmount(range[2]) : null;
    const averageCheck =
      min !== null && max !== null
        ? Math.round((min + max) / 2)
        : min;

    return {
      description,
      averageCheck,
      currency:
        averageCheck !== null
          ? placeCurrencyFromText(priceSource, "")
          : null,
    };
  };


  const tripadvisorDescriptionCandidate = (value) => {
    const candidate = cleanText(value || "");
    if (candidate.length < 40 || candidate.length > 900) return "";
    if (candidate.split(/\s+/).length < 7) return "";
    if (
      /(?:объективн(?:ых|ые)?\s+отзыв|на\s+сайте\s+tripadvisor|ranked\s+\d+|travell?er\s+reviews?|read\s+\d+\s+reviews?|из\s+5\s+на\s+сайте\s+tripadvisor|№\s*\d+\s+из\s+\d+)/i.test(candidate)
      || /(?:^|\s)(?:https?:\/\/|www\.|\+?\d[\d\s()-]{7,})/i.test(candidate)
      || /^(?:Открыто|Закрыто|Open|Closed|Часы работы|Hours|Местоположение|Location|Отзывы|Reviews|Фото|Photos|Меню|Menu|Краткий обзор|Quick overview|Обзор|Overview)$/i.test(candidate)
    ) {
      return "";
    }
    return candidate;
  };

  const tripadvisorDescriptionFromDom = (bodyRaw) => {
    const selectors = [
      '[data-automation="restaurantsAboutInfoBlock"] [data-automation*="description" i]',
      '[data-automation="restaurantsAboutInfoBlock"] p',
      '[data-automation="restaurantsAboutInfoBlock"] [role="paragraph"]',
      '[data-automation="restaurantsAboutInfoBlock"] span',
      '[data-automation*="restaurantAbout" i] p',
      '[data-automation*="restaurantAbout" i] span',
      '[data-automation*="aboutInfo" i] p',
    ];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const candidate = tripadvisorDescriptionCandidate(
          node?.innerText || node?.textContent || "",
        );
        if (candidate) return candidate;
      }
    }

    const lines = String(bodyRaw || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean);
    const summaryIndex = lines.findIndex((line) =>
      /^(?:Краткий обзор|Quick overview|Об этом ресторане|About this restaurant|About)$/i.test(line),
    );
    if (summaryIndex < 0) return "";

    for (
      let index = summaryIndex + 1;
      index < Math.min(lines.length, summaryIndex + 42);
      index += 1
    ) {
      if (/^(?:Отзывы|Reviews)$/i.test(lines[index])) break;
      const candidate = tripadvisorDescriptionCandidate(lines[index]);
      if (candidate) return candidate;
    }
    return "";
  };

  const placeFoodServiceEvidence = (raw) => {
    const lines = String(raw || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean)
      .slice(0, 180);
    const values = [];
    let score = 0;

    for (const signal of placeServiceSignals) {
      const pattern = new RegExp(signal.pattern, "i");
      const matched = lines.find((value) => pattern.test(value));
      if (!matched) continue;
      score += signal.weight;
      if (!values.includes(matched)) values.push(matched);
    }

    return {
      score,
      values: values.slice(0, 8),
    };
  };

  const categoryTextsFromSelectors = (selectors) => {
    const values = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const value = cleanText(node?.textContent || node?.getAttribute?.("aria-label") || "");
        if (!value || value.length > 180 || values.includes(value)) continue;
        values.push(value);
        if (values.length >= 10) return values;
      }
    }
    return values;
  };

  const nearbyHeaderCategoryTexts = (provider) => {
    const heading =
      provider === "google_maps"
        ? document.querySelector("h1.DUwDvf")
        : provider === "yandex_maps"
          ? (
              document.querySelector("h1.orgpage-header-view__header")
              || document.querySelector("h1")
            )
          : null;
    const root = heading?.parentElement?.parentElement || heading?.parentElement || null;
    if (!root?.querySelectorAll) return [];

    const values = [];
    for (const node of root.querySelectorAll("button, [role='button'], [itemprop='category'], a")) {
      const value = cleanText(node?.textContent || node?.getAttribute?.("aria-label") || "");
      if (
        !value
        || value.length > 120
        || values.includes(value)
        || (!placeTypeFromText(value) && !isNonFoodCategoryText(value))
      ) continue;
      values.push(value);
      if (values.length >= 6) break;
    }
    return values;
  };

  const earlyBodyCategoryTexts = (raw, title) => {
    const values = [];
    const cleanTitle = cleanText(title || "").toLowerCase();
    const lines = String(raw || "").split(/\n+/).slice(0, 50);
    for (const rawLine of lines) {
      const value = cleanText(rawLine);
      if (!value || value.length > 120 || value.toLowerCase() === cleanTitle) continue;
      if (value.split(/\s+/).length > 8) continue;
      if (/^(?:Рейтинг|Отзывы|Фото|Меню|Адрес|Address|Контакты|Contacts|Время работы|Hours)$/i.test(value)) continue;
      if (!placeTypeFromText(value) && !isNonFoodCategoryText(value)) continue;
      if (!values.includes(value)) values.push(value);
      if (values.length >= 6) break;
    }
    return values;
  };

  const googleCategoryTextIsUsable = (raw, selectedTitle = "") => {
    const value = cleanText(raw || "");
    if (!value || value.length > 90 || value.split(/\s+/).length > 8) return false;

    const normalized = value.toLowerCase();
    const title = cleanText(selectedTitle || "").toLowerCase();
    if (title && (normalized === title || normalized.includes(title))) return false;
    if (!placeTypeFromText(value) && !isNonFoodCategoryText(value)) return false;

    if (
      /\d/.test(value)
      || /(?:на фото|photos?|отзыв|reviews?|рейтинг|rating|открыт|закрыт|hours?|улиц|ул\.?|просп|пр\.?|street|road|avenue|шоссе|наб\.?|набереж|площад|дом\s|маршрут|directions)/i.test(value)
    ) {
      return false;
    }

    return true;
  };

  const googleSelectedCardCategoryTexts = () => {
    const root = googleSelectedCardRoot();
    if (!root) return [];

    const heading =
      root.querySelector?.("h1.DUwDvf")
      || root.querySelector?.("h1")
      || document.querySelector("h1.DUwDvf")
      || document.querySelector("h1");
    const title = cleanText(heading?.textContent || "");
    const values = [];

    const add = (raw) => {
      const value = cleanText(raw || "");
      if (!googleCategoryTextIsUsable(value, title) || values.includes(value)) return;
      values.push(value);
    };

    for (const node of root.querySelectorAll?.(
      'button.DkEaL, button[jsaction*="pane.rating.category"], [jsaction*="pane.rating.category"], [data-item-id="category"], [data-item-id*="category"], [itemprop="category"]',
    ) || []) {
      add(node?.textContent || node?.getAttribute?.("aria-label") || "");
      if (values.length >= 6) return values;
    }

    const lines = googleSelectedCardText()
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean);
    const normalizedTitle = title.toLowerCase();
    const titleIndex = normalizedTitle
      ? lines.findIndex((line) => line.toLowerCase() === normalizedTitle)
      : -1;
    const start = titleIndex >= 0 ? titleIndex + 1 : 0;
    for (const value of lines.slice(start, start + 24)) {
      add(value);
      if (values.length >= 6) break;
    }
    return values;
  };

  const providerCategoryTexts = (source, bodyRaw) => {
    const selectors =
      source.provider === "google_maps"
        ? [
            "button.DkEaL",
            'button[jsaction*="pane.rating.category"]',
            '[jsaction*="pane.rating.category"]',
            '[data-item-id="category"]',
            '[data-item-id*="category"]',
            '[itemprop="category"]',
          ]
        : source.provider === "yandex_maps"
          ? [
              ".orgpage-categories-info-view",
              '[class*="orgpage-categories-info-view"]',
              '[class*="business-card-title-view__description"]',
              '[class*="business-card-title-view__category"]',
              '[class*="orgpage-header-view__category"]',
              '[itemprop="category"]',
            ]
          : source.provider === "tripadvisor"
            ? ['[data-automation="restaurantsAboutInfoBlock"]']
            : [];

    const direct = categoryTextsFromSelectors(selectors);
    if (source.provider === "google_maps") {
      const title = text("h1.DUwDvf") || text("h1");
      return [...googleSelectedCardCategoryTexts(), ...direct]
        .filter((value) => googleCategoryTextIsUsable(value, title))
        .filter((value, index, all) => value && all.indexOf(value) === index)
        .slice(0, 6);
    }
    if (source.provider === "yandex_maps") {
      return direct
        .filter((value) => Boolean(placeTypeFromText(value) || isNonFoodCategoryText(value)))
        .filter((value, index, all) => value && all.indexOf(value) === index)
        .slice(0, 6);
    }

    const nearby = nearbyHeaderCategoryTexts(source.provider);
    const body = earlyBodyCategoryTexts(bodyRaw, text("h1"));
    return [...direct, ...nearby, ...body]
      .filter((value, index, all) => value && all.indexOf(value) === index)
      .slice(0, 12);
  };

  const placeCapture = () => {
    const source = placeSource();
    if (!source) return null;

    const bodyRaw = String(document.body?.innerText || "");
    const bodyText = cleanText(bodyRaw);
    const tripadvisorDescription =
      source.provider === "tripadvisor"
        ? tripadvisorDescriptionFromDom(bodyRaw)
        : "";
    const entity = ldFoodPlaceEntity();
    const nonFoodEntity = ldNonFoodPlaceEntity();
    const yandexBusiness =
      source.provider === "yandex_maps"
        ? yandexStateBusiness(source.externalId)
        : null;
    const yandexDetails =
      source.provider === "yandex_maps"
        ? yandexBodyDetails(bodyRaw)
        : {
            address: "",
            shortDescription: "",
            featureText: "",
            featureLines: [],
            featureTraits: [],
            cuisines: [],
            nonFoodFirst: false,
          };
    const yandexFeatures =
      source.provider === "yandex_maps"
        ? yandexStateFeatureDetails(yandexBusiness)
        : { averageCheck: null, currency: null, cuisines: [], traits: [] };
    const googleDetails =
      source.provider === "google_maps"
        ? (() => {
            const parsed = googleBodyDetails(googleSelectedCardText());
            return {
              ...parsed,
              description: googleAboutDescription() || parsed.description,
            };
          })()
        : { description: "", averageCheck: null, currency: null };
    const yandexImageCategory =
      source.provider === "yandex_maps"
        ? yandexImageCategoryEvidence()
        : { text: "", nonFoodFirst: false };
    const providerCategories = [
      ...yandexStateCategories(yandexBusiness),
      ...providerCategoryTexts(source, bodyRaw),
    ]
      .filter((value, index, all) => value && all.indexOf(value) === index)
      .slice(0, 12);
    const serviceEvidence = placeFoodServiceEvidence(
      source.provider === "google_maps" ? googleSelectedCardText() : bodyRaw,
    );
    const structuredCategory = cleanText(
      typeof entity?.category === "string"
        ? entity.category
        : typeof entity?.additionalType === "string"
          ? entity.additionalType
          : "",
    );
    const sourceCategory =
      providerCategories[0]
      || structuredCategory
      || ldTypeValues(entity)[0]
      || "";

    const sourceCategoryIsNonFood =
      Boolean(sourceCategory)
      && isNonFoodCategoryText(sourceCategory)
      && !placeTypeFromText(sourceCategory);

    if (
      !entity
      && (
        nonFoodEntity
        || sourceCategoryIsNonFood
        || (
          source.provider === "yandex_maps"
          && (yandexImageCategory.nonFoodFirst || yandexDetails.nonFoodFirst)
        )
      )
      && (source.provider === "google_maps" || source.provider === "yandex_maps")
    ) {
      return null;
    }

    const bodyEvidence =
      source.provider === "tripadvisor" || source.provider === "restoclub"
        ? bodyText.slice(0, 4000)
        : "";
    const cuisineEvidence = Array.isArray(entity?.servesCuisine)
      ? entity.servesCuisine.join(" · ")
      : cleanText(entity?.servesCuisine || "");
    const placeEvidence = [
      sourceCategory,
      ...providerCategories,
      ldTypeValues(entity).join(" "),
      cuisineEvidence,
      ...serviceEvidence.values,
      yandexImageCategory.text,
      yandexDetails.featureText,
      meta('meta[property="og:description"]'),
      meta('meta[name="description"]'),
      cleanText(document.title),
      bodyEvidence,
    ]
      .map((value) => cleanText(String(value || "")))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 12);

    const placeType =
      placeTypeFromEntity(entity)
      || placeTypeFromText(sourceCategory)
      || placeTypeFromText(placeEvidence.join(" · "))
      || (serviceEvidence.score >= placeServiceThreshold ? "restaurant" : null);
    if (!placeType && !sourceCategory) return null;

    const rawTitle =
      cleanText(entity?.name || "") ||
      cleanText(yandexBusiness?.title || yandexBusiness?.shortTitle || "") ||
      (source.provider === "google_maps" ? text("h1.DUwDvf") : "") ||
      (source.provider === "yandex_maps" ? text("h1.orgpage-header-view__header") : "") ||
      text("h1") ||
      meta('meta[property="og:title"]') ||
      cleanText(document.title);
    const title = rawTitle
      .replace(/\s*[—-]\s*(?:Яндекс Карты|Yandex Maps|Google Maps|Tripadvisor|Restoclub).*$/i, "")
      .replace(/\s*[|·]\s*(?:Google Maps|Tripadvisor|Restoclub).*$/i, "")
      .trim();
    if (!title) return null;

    const structuredAddress = placeAddressData(entity);
    const stateAddress =
      source.provider === "yandex_maps"
        ? yandexStateAddress(yandexBusiness)
        : "";
    const domAddress =
      source.provider === "google_maps"
        ? placeAddressFromSelectors([
            '[data-item-id="address"] .Io6YTe',
            'button[data-item-id="address"]',
            '[data-item-id="address"]',
            '[aria-label^="Address:" i]',
            '[aria-label^="Адрес:" i]',
          ])
        : source.provider === "yandex_maps"
          ? placeAddressFromSelectors([
              ".business-contacts-view__address",
              '[class*="business-contacts-view__address"]',
              '[class*="business-contacts-view__address-link"]',
              '[class*="orgpage-header-view__address"]',
              '[class*="business-card-title-view__address"]',
              '[itemprop="address"]',
              '[itemprop="streetAddress"]',
              '[aria-label^="Адрес:" i]',
              '[aria-label^="Address:" i]',
            ])
          : source.provider === "tripadvisor"
            ? placeAddressFromSelectors([
                '[data-automation="restaurantsAboutInfoBlock"] address',
                '[data-automation="restaurantsAboutInfoBlock"] [data-automation*="location"]',
                '[data-automation*="location"] address',
                'address',
              ])
            : "";
    const restoclubAddress =
      source.provider === "restoclub"
        ? cleanText(bodyRaw.match(/Адрес:\s*([^\n]{3,300})/i)?.[1] || "")
        : "";
    const mapBodyAddress =
      source.provider === "google_maps" || source.provider === "yandex_maps"
        ? cleanText(
            bodyRaw.match(/(?:^|\n)\s*(?:Адрес|Address)\s*:?\s*([^\n]{3,300})/im)?.[1] || "",
          )
        : "";
    const address =
      stateAddress
      || structuredAddress.address
      || domAddress
      || restoclubAddress
      || (source.provider === "yandex_maps" ? yandexDetails.address : "")
      || mapBodyAddress
      || visibleMapAddress(source.provider, bodyRaw)
      || null;

    const tripadvisorCity =
      source.provider === "tripadvisor"
        ? cleanText(
            (
              meta('meta[name="description"]')
              || meta('meta[property="og:description"]')
              || ""
            ).match(/^[^,]{1,180},\s*([^:]{2,100}):/)?.[1] || "",
          )
        : "";
    const yandexCity =
      source.provider === "yandex_maps"
        ? (
            yandexStateCity(yandexBusiness)
            || cityFromAddress(stateAddress || domAddress || address)
          )
        : null;
    let city = yandexCity || structuredAddress.city || tripadvisorCity || cityFromAddress(address);
    if (!city && source.provider === "restoclub") {
      const citySlug = source.externalId.split("/")[0];
      if (citySlug === "msk") city = "Москва";
      if (citySlug === "spb") city = "Санкт-Петербург";
    }
    if (!city) {
      const titleMatch = cleanText(document.title).match(
        /(?:^|[,·])\s*(Москва|Санкт-Петербург|Алматы|Астана|Moscow|Saint Petersburg|Almaty|Astana)\s*(?:[,·—-]|$)/i,
      );
      city = cleanText(titleMatch?.[1] || "") || null;
    }

    if (
      (source.provider === "google_maps" || source.provider === "yandex_maps")
      && (!address || !city)
    ) {
      throw new Error(
        "Advisor видит карточку заведения, но не смог прочитать её адрес. Карточка не сохранена: откройте полную карточку заведения и повторите добавление.",
      );
    }

    const imageUrl =
      (
        source.provider === "yandex_maps"
          ? yandexStatePhoto(yandexBusiness)
          : null
      )
      || safePlaceImageUrl(ldImageUrl(entity))
      || placeImageFromDom(source.provider)
      || safePlaceImageUrl(
        meta('meta[property="og:image:secure_url"]')
        || meta('meta[property="og:image"]')
        || meta('meta[name="twitter:image"]'),
      );

    const rawCuisine = entity?.servesCuisine;
    const structuredCuisines =
      Array.isArray(rawCuisine)
        ? rawCuisine
        : typeof rawCuisine === "string"
          ? rawCuisine.split(",")
          : [];
    const restoclubCuisine =
      source.provider === "restoclub"
        ? (bodyRaw.match(/Кухня:\s*([^\n]{2,300})/i)?.[1] || "").split(",")
        : [];
    const cuisines = [
      ...structuredCuisines,
      ...restoclubCuisine,
      ...yandexFeatures.cuisines,
      ...yandexDetails.cuisines,
    ]
      .map((value) => cleanText(String(value || "")))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 16);

    const restoclubMetro =
      source.provider === "restoclub"
        ? cleanText(bodyRaw.match(/Адрес:\s*[^\n]+\n\s*([^\n]{2,100})/i)?.[1] || "")
        : "";
    const metro =
      restoclubMetro ||
      cleanText(bodyRaw.match(/(?:Метро|metro):?\s*([^\n·]{2,100})/i)?.[1] || "") ||
      null;

    const averageRaw =
      bodyRaw.match(/(?:Средний|Ср\.)\s*(?:чек|сч[её]т)\s*:?\s*(?:от\s*)?([\d\s\u00a0\u202f]+)/i)?.[1]
      || bodyRaw.match(/average\s+(?:check|bill)\s*:?\s*(?:from\s*)?([\d\s\u00a0\u202f]+)/i)?.[1]
      || null;
    const averageValue = averageRaw ? Number(averageRaw.replace(/\D/g, "")) : null;
    const averageCheck =
      yandexFeatures.averageCheck
      ?? googleDetails.averageCheck
      ?? (
        Number.isFinite(averageValue) && averageValue > 0 && averageValue < 100000000
          ? averageValue
          : null
      );

    const defaultScale = source.provider === "restoclub" ? 10 : 5;
    const structuredRating =
      ldRating(entity)
      ?? (source.provider === "yandex_maps" ? yandexStateRating(yandexBusiness) : null);
    const ratingNode =
      source.provider === "google_maps"
        ? (
            document.querySelector('[role="img"][aria-label*="star" i]')?.getAttribute("aria-label") ||
            text(".F7nice")
          )
        : source.provider === "yandex_maps"
          ? text('[class*="business-rating-badge-view__rating-text"]')
          : source.provider === "tripadvisor"
            ? (
                text('[data-automation="bubbleRatingValue"]') ||
                document.querySelector('[aria-label*="bubble rating" i]')?.getAttribute("aria-label") ||
                ""
              )
            : text('[class*="rating"]');
    let rating = structuredRating;
    if (rating === null) rating = placeRatingFromText(ratingNode, defaultScale, true);
    if (rating === null) rating = placeRatingFromText(bodyText.slice(0, 2500), defaultScale);
    if (
      rating === null
      && (source.provider === "google_maps" || source.provider === "yandex_maps")
    ) {
      rating = placeRatingFromVisibleCard(bodyRaw, defaultScale);
    }
    if (rating === null && source.provider === "restoclub") {
      const isolated = bodyRaw.match(
        /(?:^|\n)\s*(10(?:[.,]0)?|[0-9](?:[.,][0-9]))\s*(?=\n|$)/m,
      )?.[1];
      const parsed = isolated ? Number(isolated.replace(",", ".")) : Number.NaN;
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10) rating = parsed;
    }
    const ratingScale = rating !== null && rating > 5 ? 10 : defaultScale;

    const descriptionCandidate =
      source.provider === "yandex_maps"
        ? yandexDetails.shortDescription
        : source.provider === "google_maps"
          ? (
              cleanText(entity?.description || "")
              || googleDetails.description
            )
          : source.provider === "tripadvisor"
            ? (
                tripadvisorDescription
                || cleanText(entity?.description || "")
                || meta('meta[name="description"]')
                || meta('meta[property="og:description"]')
                || ""
              )
            : (
                cleanText(entity?.description || "")
                || meta('meta[name="description"]')
                || meta('meta[property="og:description"]')
                || ""
              );
    const promotionalDescription =
      source.provider === "tripadvisor"
      && /(?:просмотр(?:ите|еть).{0,120}(?:отзыв|рейтинг)|объективн(?:ых|ые)?\s+отзыв|на\s+сайте\s+tripadvisor|ranked\s+\d+|travell?er\s+reviews?|read\s+\d+\s+reviews?)/i.test(descriptionCandidate);
    const placeTypeLabel =
      placeType === "coffee_shop"
        ? "Кофейня"
        : placeType === "bar"
          ? "Бар"
          : placeType === "cafe"
            ? "Кафе"
            : "Ресторан";
    const neutralDescription =
      placeTypeLabel
      + (city ? " · " + city : "")
      + (cuisines.length ? ". Кухня: " + cuisines.slice(0, 4).join(", ") + "." : ".");
    const googleFallbackDescription =
      sourceCategory && sourceCategory.length <= 140
        ? sourceCategory + (city ? " · " + city : "") + "."
        : neutralDescription;
    const description =
      source.provider === "google_maps"
        ? (descriptionCandidate || googleFallbackDescription)
        : source.provider === "yandex_maps"
          ? (descriptionCandidate || neutralDescription)
          : promotionalDescription
            ? neutralDescription
            : (descriptionCandidate || neutralDescription || null);
    const traits = [
      ...providerCategories,
      ...(
        source.provider === "yandex_maps"
          ? (
              yandexFeatures.traits.length > 0
                ? yandexFeatures.traits
                : yandexDetails.featureTraits
            )
          : []
      ),
    ]
      .map((value) => cleanText(value || ""))
      .filter(Boolean)
      .filter((value) =>
        source.provider !== "yandex_maps"
        || !/^(?:кафе|ресторан|бар|кофейня)(?:s*[,/·]s*(?:кафе|ресторан|бар|кофейня))*$/i.test(value)
      )
      .filter((value) =>
        value.length <= 90
        && !/^(?:Кухня|Средний чек|Цены|Рейтинг|Отзывы|Фото|Меню|Новости)$/i.test(value)
      )
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 12);

    return {
      kind: "place",
      sourceProvider: source.provider,
      sourceUrl: source.sourceUrl,
      externalId: source.externalId,
      title,
      imageUrl,
      description,
      placeType,
      sourceCategory: sourceCategory || null,
      placeEvidence,
      country:
        structuredAddress.country
        || (source.provider === "yandex_maps" ? yandexStateCountry(yandexBusiness) : null),
      region: structuredAddress.region || city,
      city,
      address,
      metro,
      cuisines,
      averageCheck,
      currency:
        averageCheck
          ? (
              yandexFeatures.currency
              || googleDetails.currency
              || placeCurrencyFromText(
                bodyRaw,
                structuredAddress.country
                || (source.provider === "yandex_maps" ? yandexStateCountry(yandexBusiness) : null),
              )
              || (source.provider === "restoclub" ? "RUB" : null)
            )
          : null,
      rating,
      ratingScale,
      traits,
      capturedAt: Date.now(),
    };
  };



  
  const eventUrlCandidates = () => {
    const values = [
      location.href,
      document.querySelector('link[rel="canonical"]')?.href || "",
      meta('meta[property="og:url"]'),
    ];
    const result = [];
    for (const value of values) {
      if (!value) continue;
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== "https:") continue;
        if (result.some((item) => item.href === url.href)) continue;
        result.push(url);
      } catch {}
    }
    return result;
  };

  const kassirEventSignal = () => {
    const body = cleanText(document.body?.innerText || "").slice(0, 12000);
    return /(?:Купить билеты|Билеты от|Место проведения|афиша на \d{4}|Доступные билеты)/i.test(body);
  };

  const kudagoPlaceSignal = () => {
    const body = cleanText(document.body?.innerText || "").slice(0, 16000);
    return (
      /(?:Адрес|Расположение).{0,1200}(?:Расписание|Телефон|Ближайшее метро|Сайт)/i.test(body)
      || /(?:Расписание|Телефон).{0,1200}(?:Адрес|Расположение|Ближайшее метро)/i.test(body)
      || /Пожалуйста, скажите владельцам места, что нашли их на KudaGo/i.test(body)
    );
  };

  const eventProviderSource = () => {
    const candidates = eventUrlCandidates();

    for (const url of candidates) {
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (host === "afisha.yandex.ru") {
        const match = path.match(/^\/([^/]+)\/([^/]+)\/([^/]+)$/i);
        if (!match) continue;
        const providerCategory = match[2].toLowerCase();
        const nonEventRoots = new Set([
          "selections","search","cinema","places","restaurants","events",
        ]);
        if (nonEventRoots.has(providerCategory)) continue;
        return {
          provider: "yandex_afisha",
          externalId: match.slice(1).join("/"),
          sourceUrl: "https://afisha.yandex.ru" + path,
          providerCategory,
          citySlug: match[1].toLowerCase(),
        };
      }

      if (host === "kassir.ru" || host.endsWith(".kassir.ru")) {
        const segments = path.split("/").filter(Boolean);
        if (segments.length < 2) continue;

        const knownEventRoots = new Set([
          "koncert","bilety-na-koncert","teatr","cirk","shou","muzey",
          "vystavki","ekskursii","sport","detyam","obuchenie","festival",
          "festivali","razvlecheniya","stand-up","standup","prazdniki",
          "drugie","tourist","kino",
        ]);
        const nonEventRoots = new Set([
          "search","poisk","venue","venues","place","places","hall","halls",
          "selection","selections","catalog","afisha","pages",
          "news","article","articles","help","support","contacts","about",
          "certificate","certificates","cart","basket","payment","profile",
          "personal","login","register","rules","offer",
        ]);

        let categoryIndex = 0;
        let citySlug = host === "kassir.ru" ? null : host.split(".")[0] || null;
        if (
          host === "kassir.ru"
          && segments.length >= 3
          && knownEventRoots.has(segments[1].toLowerCase())
        ) {
          citySlug = segments[0].toLowerCase();
          categoryIndex = 1;
        }

        const providerCategory = segments[categoryIndex].toLowerCase();
        if (nonEventRoots.has(providerCategory)) continue;
        if (!knownEventRoots.has(providerCategory) && !kassirEventSignal()) continue;

        return {
          provider: "kassir",
          externalId: host + path,
          sourceUrl: "https://" + host + path,
          providerCategory,
          citySlug,
        };
      }

      if (host === "kudago.com") {
        const segments = path.split("/").filter(Boolean);
        const eventIndex = segments.findIndex((value) => value.toLowerCase() === "event");
        if (eventIndex >= 1 && eventIndex < segments.length - 1) {
          const citySlug = segments[eventIndex - 1].toLowerCase();
          const eventSlug = segments.slice(eventIndex + 1).join("/");
          return {
            provider: "kudago",
            externalId: citySlug + "/" + eventSlug,
            sourceUrl: "https://kudago.com/" + segments.join("/") + "/",
            providerCategory: "event",
            citySlug,
          };
        }

        const placeIndex = segments.findIndex((value) => value.toLowerCase() === "place");
        if (
          placeIndex >= 1
          && placeIndex < segments.length - 1
          && kudagoPlaceSignal()
        ) {
          const citySlug = segments[placeIndex - 1].toLowerCase();
          const placeSlug = segments.slice(placeIndex + 1).join("/");
          return {
            provider: "kudago",
            externalId: citySlug + "/place/" + placeSlug,
            sourceUrl: "https://kudago.com/" + segments.join("/") + "/",
            providerCategory: "place",
            citySlug,
          };
        }
      }
    }

    return null;
  };

  const cityFromSlug = (value) => {
    const map = {
      "saint-petersburg": "Санкт-Петербург",
      "spb": "Санкт-Петербург",
      "moscow": "Москва",
      "msk": "Москва",
      "kazan": "Казань",
      "ekaterinburg": "Екатеринбург",
      "nsk": "Новосибирск",
      "novosibirsk": "Новосибирск",
    };
    return map[String(value || "").toLowerCase()] || null;
  };

  const ldEventEntity = () =>
    jsonLdEntities().find((entity) =>
      ldTypeValues(entity).some((value) =>
        /(?:MusicEvent|TheaterEvent|EducationEvent|ExhibitionEvent|Festival|SportsEvent|Event)$/i.test(value),
      ),
    ) || null;

  const ldAddressParts = (entity) => {
    const locationValue = Array.isArray(entity?.location)
      ? entity.location[0]
      : entity?.location;
    const location = locationValue && typeof locationValue === "object"
      ? locationValue
      : null;
    const rawAddress = location?.address;
    const address = rawAddress && typeof rawAddress === "object" ? rawAddress : null;
    const countryValue = address?.addressCountry;
    const country = typeof countryValue === "string"
      ? cleanText(countryValue)
      : cleanText(countryValue?.name || "");
    return {
      venueName: cleanText(location?.name || ""),
      city: cleanText(address?.addressLocality || ""),
      region: cleanText(address?.addressRegion || ""),
      address: cleanText(address?.streetAddress || ""),
      country,
    };
  };

  const isoDateParts = (raw) => {
    const value = cleanText(String(raw || ""));
    const date = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] || null;
    const time = value.match(/[T ](\d{2}:\d{2})(?::\d{2})?/)?.[1] || null;
    return { date, time };
  };

  const eventScheduleTexts = (sourceProvider = null) => {
    const values = [];
    const append = (raw) => {
      const value = cleanText(raw || "");
      if (!value || value.length > 220) return;
      if (
        !/(?:\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)|20\d{2}-\d{2}-\d{2})/i.test(value)
      ) return;
      if (!values.includes(value)) values.push(value);
    };

    const selectors = sourceProvider
      ? [
          "[data-testid*='date' i]",
          "[data-testid*='schedule' i]",
          "[class*='schedule' i] button",
          "[class*='schedule' i] [role='button']",
          "[class*='session' i]",
          "[class*='seance' i]",
          "main button",
          "main [role='button']",
          "main label",
          "main input",
        ]
      : [
          "time[datetime]",
          "[itemprop='startDate']",
          "[itemprop='endDate']",
          "[data-date]",
          "[data-datetime]",
          "[data-testid*='date' i]",
          "[data-testid*='schedule' i]",
          "[class*='schedule' i] button",
          "[class*='schedule' i] [role='button']",
          "[class*='session' i]",
          "[class*='seance' i]",
          "main button",
          "main [role='button']",
          "main label",
          "main input",
        ];

    for (const node of document.querySelectorAll(selectors.join(","))) {
      append(node.getAttribute("datetime"));
      append(node.getAttribute("content"));
      append(node.getAttribute("data-date"));
      append(node.getAttribute("data-datetime"));
      append(node.getAttribute("aria-label"));
      append(node.getAttribute("value"));
      append(node.textContent);
      if (values.length >= 80) break;
    }
    return values;
  };

  const domEventDateTimes = () => {
    const now = new Date();
    const todayIso = [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const values = [...document.querySelectorAll(
      "time[datetime], [itemprop='startDate'], [itemprop='endDate'], [data-date], [data-datetime]",
    )]
      .flatMap((node) => [
        cleanText(node.getAttribute("datetime") || ""),
        cleanText(node.getAttribute("content") || ""),
        cleanText(node.getAttribute("data-date") || ""),
        cleanText(node.getAttribute("data-datetime") || ""),
      ])
      .filter(Boolean)
      .map(isoDateParts)
      .filter((value) => value.date && value.date >= todayIso)
      .filter((value, index, all) =>
        all.findIndex((candidate) =>
          candidate.date === value.date && candidate.time === value.time
        ) === index
      )
      .sort((left, right) =>
        left.date.localeCompare(right.date)
        || String(left.time || "").localeCompare(String(right.time || ""))
      );
    return values;
  };

  const eventPriceTextRange = (raw) => {
    const value = cleanText(raw || "");
    if (!value) return null;

    const amount = (rawAmount) => parsePrice(rawAmount);
    const explicit = value.match(
      /(?:от\s*)?(\d[\d \u00a0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)?\s*(?:до|[–—-])\s*(\d[\d \u00a0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)/i,
    );
    if (explicit) {
      const first = amount(explicit[1]);
      const second = amount(explicit[2]);
      const zeroAmount = (rawAmount) =>
        /^0(?:[.,]0{1,2})?$/.test(cleanText(String(rawAmount || "")).replace(/\s+/g, ""));
      if (first !== null && second !== null) {
        return {
          priceMin: Math.min(first, second),
          priceMax: Math.max(first, second),
          currency: "RUB",
        };
      }
      if (first !== null && zeroAmount(explicit[2])) {
        return { priceMin: first, priceMax: null, currency: "RUB" };
      }
      if (second !== null && zeroAmount(explicit[1])) {
        return { priceMin: second, priceMax: null, currency: "RUB" };
      }
    }

    const fromTo = value.match(
      /от\s*(\d[\d \u00a0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)?(?:\s+до\s+(\d[\d \u00a0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)?)?/i,
    );
    if (fromTo) {
      const min = amount(fromTo[1]);
      const max = fromTo[2] ? amount(fromTo[2]) : null;
      if (min !== null) {
        return {
          priceMin: min,
          priceMax: max !== null && max !== min ? max : null,
          currency: "RUB",
        };
      }
    }
    return null;
  };

  const eventPriceTexts = (lineSource = null) => {
    const values = [];
    const append = (raw) => {
      const value = cleanText(raw || "");
      if (!value || value.length > 500 || !/(?:₽|руб\.?|цена|билет)/i.test(value)) return;
      if (/(?:кэшбэк|бонус|скидк|рассроч|долями|частями|плат[её]ж)/i.test(value)) return;
      if (!values.includes(value)) values.push(value);
    };

    if (!Array.isArray(lineSource)) {
      for (const node of document.querySelectorAll(
        [
          "[itemprop='offers']",
          "[itemprop='price']",
          "[data-testid*='price' i]",
          "[data-testid*='ticket' i]",
          "[class*='price' i]",
          "[class*='ticket' i] [class*='cost' i]",
          "[class*='ticket' i] [class*='price' i]",
        ].join(","),
      )) {
        append(node.getAttribute("content"));
        append(node.textContent);
        if (values.length >= 50) break;
      }
    }

    const lines = (Array.isArray(lineSource) ? lineSource : visibleEventLines()).slice(0, 260);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/(?:от\s*\d|цена|билет).{0,100}(?:₽|руб\.?)/i.test(line)) append(line);
      if (/^(?:цена|стоимость)(?:\s|$)/i.test(line)) {
        append(lines.slice(index, index + 3).join(" "));
      }
    }
    return values;
  };

  const eventPriceRange = (entity, source, eventLines, title) => {
    const offers = Array.isArray(entity?.offers) ? entity.offers : entity?.offers ? [entity.offers] : [];
    let min = null;
    let max = null;
    let currency = null;
    for (const offer of offers) {
      if (!offer || typeof offer !== "object") continue;
      const structuredRange =
        typeof offer.price === "string"
          ? eventPriceTextRange(offer.price)
          : null;
      if (structuredRange) {
        min = min === null
          ? structuredRange.priceMin
          : Math.min(min, structuredRange.priceMin);
        if (structuredRange.priceMax !== null) {
          max = max === null
            ? structuredRange.priceMax
            : Math.max(max, structuredRange.priceMax);
        }
      } else {
        const low = parsePrice(offer.lowPrice ?? offer.price);
        const high = parsePrice(offer.highPrice ?? offer.price);
        if (low !== null) min = min === null ? low : Math.min(min, low);
        if (high !== null) max = max === null ? high : Math.max(max, high);
      }
      currency ||= cleanText(offer.priceCurrency || "");
    }

    const texts = eventPriceTexts(providerEventPriceLines(source, eventLines, title));
    const explicitTextRange = texts
      .map((value) => eventPriceTextRange(value))
      .find((value) => value?.priceMax !== null) || null;
    if (explicitTextRange) return explicitTextRange;

    if (min !== null) {
      return {
        priceMin: min,
        priceMax: max === null || max === min ? null : max,
        currency: currency ? currency.toUpperCase().slice(0, 8) : "RUB",
      };
    }

    for (const value of texts) {
      const parsed = eventPriceTextRange(value);
      if (parsed) return parsed;
    }

    const singleValues = [];
    for (const value of texts) {
      for (const match of value.matchAll(/(\d[\d \u00a0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?)/gi)) {
        const parsed = parsePrice(match[1]);
        if (parsed !== null && parsed >= 100) singleValues.push(parsed);
      }
    }
    if (singleValues.length) {
      return {
        priceMin: Math.min(...singleValues),
        priceMax: singleValues.length > 1 ? Math.max(...singleValues) : null,
        currency: "RUB",
      };
    }

    return { priceMin: null, priceMax: null, currency: null };
  };

  const eventBreadcrumbs = () => {
    const values = uniqueTexts(
      document.querySelectorAll(
        '[class*="breadcrumb" i] a, [class*="breadcrumbs" i] a, [itemprop="itemListElement"] a, [itemprop="itemListElement"] [itemprop="name"]',
      ),
      16,
    );
    const breadcrumbEntity = jsonLdEntities().find((entity) =>
      ldTypeValues(entity).some((value) => value === "BreadcrumbList"),
    );
    const items = Array.isArray(breadcrumbEntity?.itemListElement)
      ? breadcrumbEntity.itemListElement
      : [];
    for (const item of items) {
      const value = cleanText(
        typeof item?.name === "string"
          ? item.name
          : typeof item?.item?.name === "string"
            ? item.item.name
            : "",
      );
      if (!value || values.includes(value)) continue;
      values.push(value);
      if (values.length >= 16) break;
    }
    return values;
  };

  const eventCategory = (source, types, breadcrumbs) => {
    if (source.provider === "yandex_afisha") {
      return source.providerCategory === "concert" ? "concert" : "activity";
    }
    if (source.provider === "kassir") {
      return ["koncert", "bilety-na-koncert"].includes(source.providerCategory)
        ? "concert"
        : "activity";
    }
    if (source.providerCategory === "place") return "activity";
    if (types.some((value) => value === "MusicEvent")) return "concert";
    const eventBreadcrumbConcert = breadcrumbs.some((value) =>
      /^(?:концерт|концерты)(?:\s+в\s+.{2,80})?$/i.test(value),
    );
    return eventBreadcrumbConcert ? "concert" : "activity";
  };

  const eventActivityType = (source, breadcrumbs, title) => {
    const raw = [
      source?.providerCategory || "",
      ...breadcrumbs,
      title || "",
    ].join(" ").toLowerCase();
    if (/выстав|art\b/.test(raw)) return "exhibition";
    if (/музей|museum/.test(raw)) return "museum";
    if (/фестив/.test(raw)) return "festival";
    if (/экскурс/.test(raw)) return "excursion";
    if (/иммерсив/.test(raw)) return "immersive";
    if (/мастер.?класс|workshop|обучен/.test(raw)) return "workshop";
    if (/лекци|lecture/.test(raw)) return "lecture";
    if (/театр|спектак|theatr/.test(raw)) return "theatre_show";
    if (/ярмарк|маркет/.test(raw)) return "market_fair";
    if (/достопримеч|памятник|landmark/.test(raw)) return "landmark";
    if (/архитект/.test(raw)) return "architecture";
    if (/историч|истори[яи]/.test(raw)) return "history";
    if (/природ|ботанич|зоопарк/.test(raw)) return "nature";
    if (/смотров|viewpoint/.test(raw)) return "viewpoint";
    if (/парк/.test(raw)) return "park";
    return "other";
  };

  const visibleEventImage = () => {
    let best = null;
    let bestArea = 0;
    for (const img of document.querySelectorAll("main img, article img, img")) {
      const raw =
        img.currentSrc ||
        img.src ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-original") ||
        "";
      if (!raw) continue;
      let url = null;
      try {
        const resolved = new URL(raw, location.href);
        if (resolved.protocol !== "https:") continue;
        url = resolved.href;
      } catch {
        continue;
      }
      const hint = ((img.alt || "") + " " + url).toLowerCase();
      if (/(logo|icon|sprite|avatar|qr|payment|captcha)/.test(hint)) continue;
      const rect = img.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (rect.width < 160 || rect.height < 100 || area <= bestArea) continue;
      best = url;
      bestArea = area;
    }
    return best;
  };

  const visibleEventLines = () =>
    String(document.body?.innerText || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean)
      .slice(0, 700);

  const providerEventScheduleLines = (source, lines, title) => {
    const section = (startPattern, stopPattern, fallbackStart = -1) => {
      const detectedStart = startPattern
        ? lines.findIndex((value) => startPattern.test(value))
        : -1;
      const startIndex = detectedStart >= 0 ? detectedStart : fallbackStart;
      if (startIndex < 0) return [];
      const detectedEnd = lines.findIndex(
        (value, index) => index > startIndex && stopPattern.test(value),
      );
      const endIndex = detectedEnd > startIndex
        ? detectedEnd
        : Math.min(lines.length, startIndex + 180);
      return lines.slice(startIndex, endIndex);
    };

    if (source.provider === "yandex_afisha") {
      return section(
        /^Расписание(?:\s|$)/i,
        /^(?:О событии|Обзор|Описание|Адрес|Отзывы(?: и оценки)?)(?:\s|$)/i,
      );
    }

    if (source.provider === "kudago") {
      return section(
        /^(?:Когда\??|Расписание)(?:\s|$)/i,
        /^(?:Где\??|Дополнительная информация|Адрес|Отзывы)(?:\s|$)/i,
      );
    }

    if (source.provider === "kassir") {
      const titleIndex = title
        ? lines.findIndex((value) => value === title)
        : -1;
      return section(
        null,
        /^(?:Фото и видео|Место проведения|Отзывы|Рекомендуем)(?:\s|$)/i,
        titleIndex >= 0 ? titleIndex : 0,
      );
    }

    return [];
  };

  const providerEventPriceLines = (source, lines, title) => {
    if (source.provider === "kudago") {
      const priceIndex = lines.findIndex((value) =>
        /^(?:цена|стоимость)(?:\s|$)/i.test(value),
      );
      if (priceIndex >= 0) return lines.slice(priceIndex, priceIndex + 4);
    }

    const primary = providerEventScheduleLines(source, lines, title);
    const priceLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      const value = cleanText(lines[index] || "");
      if (
        !value
        || value.length > 500
        || !/(?:₽|руб\.?)/i.test(value)
        || !/(?:билет|цена|стоимость|\d)/i.test(value)
        || /(?:кэшбэк|бонус|скидк|рассроч|долями|частями|плат[её]ж)/i.test(value)
      ) continue;
      priceLines.push(value);
      if (priceLines.length >= 24) break;
    }

    return [...primary, ...priceLines]
      .filter((value, index, all) => value && all.indexOf(value) === index)
      .slice(0, 240);
  };

  const eventMonthNumber = (value) => {
    const token = cleanText(String(value || "")).toLowerCase().replace(/\./g, "");
    if (token.startsWith("янв")) return 1;
    if (token.startsWith("фев")) return 2;
    if (token.startsWith("мар")) return 3;
    if (token.startsWith("апр")) return 4;
    if (token === "май" || token === "мая") return 5;
    if (token.startsWith("июн")) return 6;
    if (token.startsWith("июл")) return 7;
    if (token.startsWith("авг")) return 8;
    if (token.startsWith("сен")) return 9;
    if (token.startsWith("окт")) return 10;
    if (token.startsWith("ноя")) return 11;
    if (token.startsWith("дек")) return 12;
    return null;
  };

  const EVENT_MONTH_PATTERN =
    "(?:янв(?:аря)?|фев(?:раля)?|мар(?:та)?|апр(?:еля)?|мая|май|июн(?:я)?|июл(?:я)?|авг(?:уста)?|сен(?:т(?:ября)?)?|окт(?:ября)?|ноя(?:бря)?|дек(?:абря)?)";
  const EVENT_WEEKDAY_PATTERN =
    "(?:пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)";

  const eventIsoDate = (day, month, year) => {
    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2020 || year > 2100) return null;
    const value = [
      String(year),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0"),
    ].join("-");
    const parsed = new Date(value + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? null : value;
  };

  const inferredEventYear = (day, month, rawYear) => {
    if (rawYear) return Number(rawYear);
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, month - 1, day, 23, 59, 59);
    if (candidate.getTime() < now.getTime() - 86400000) year += 1;
    return year;
  };

  const russianEventDateInfo = (rawLines) => {
    const today = new Date();
    const todayIso = [
      String(today.getFullYear()),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");

    const lines = rawLines
      .map((value) => cleanText(value))
      .filter(Boolean);
    const expandedLines = [...lines];
    for (let index = 0; index < lines.length; index += 1) {
      for (let size = 2; size <= 5 && index + size <= lines.length; size += 1) {
        const joined = cleanText(lines.slice(index, index + size).join(" "));
        if (
          joined.length <= 220
          && /\d/.test(joined)
          && new RegExp(EVENT_MONTH_PATTERN, "i").test(joined)
          && !expandedLines.includes(joined)
        ) {
          expandedLines.push(joined);
        }
      }
    }

    const candidates = [];
    const ranges = [];
    const addCandidate = (dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw) => {
      const day = Number(dayRaw);
      const month = eventMonthNumber(monthRaw);
      if (!month) return;
      const year = inferredEventYear(day, month, yearRaw);
      const date = eventIsoDate(day, month, year);
      if (!date) return;
      const time =
        hourRaw != null && minuteRaw != null
          ? String(Number(hourRaw)).padStart(2, "0") + ":" + String(minuteRaw).padStart(2, "0")
          : null;
      candidates.push({ date, time });
    };

    const crossRangeRegex = new RegExp(
      "(?:^|\\s)(\\d{1,2})\\s+(?:" + EVENT_WEEKDAY_PATTERN + "\\s+)?"
      + "(" + EVENT_MONTH_PATTERN + ")(?:\\s+" + EVENT_WEEKDAY_PATTERN + ")?(?:\\s+(20\\d{2}))?"
      + "\\s*[–—-]\\s*(\\d{1,2})\\s+(?:" + EVENT_WEEKDAY_PATTERN + "\\s+)?"
      + "(" + EVENT_MONTH_PATTERN + ")(?:\\s+" + EVENT_WEEKDAY_PATTERN + ")?(?:\\s+(20\\d{2}))?",
      "i",
    );
    const sameMonthRangeRegex = new RegExp(
      "(?:^|\\s)(\\d{1,2})\\s*[–—-]\\s*(\\d{1,2})\\s+"
      + "(" + EVENT_MONTH_PATTERN + ")(?:\\s+" + EVENT_WEEKDAY_PATTERN + ")?(?:\\s+(20\\d{2}))?",
      "i",
    );
    const pairedDatesRegex = new RegExp(
      "(?:^|\\s)(\\d{1,2})\\s*(?:,|и)\\s*(\\d{1,2})\\s+"
      + "(" + EVENT_MONTH_PATTERN + ")(?:\\s+" + EVENT_WEEKDAY_PATTERN + ")?(?:\\s+(20\\d{2}))?"
      + "(?:[^\\d]{0,24}(\\d{1,2}):(\\d{2}))?",
      "i",
    );
    const singleDateRegex = new RegExp(
      "(?:^|\\s)(\\d{1,2})\\s+(?:" + EVENT_WEEKDAY_PATTERN + "\\s+)?"
      + "(" + EVENT_MONTH_PATTERN + ")(?:\\s+" + EVENT_WEEKDAY_PATTERN + ")?(?:\\s+(20\\d{2}))?"
      + "(?:[^\\d]{0,24}(\\d{1,2}):(\\d{2}))?",
      "gi",
    );

    for (const line of expandedLines) {
      const crossRange = line.match(crossRangeRegex);
      if (crossRange) {
        const startMonth = eventMonthNumber(crossRange[2]);
        const endMonth = eventMonthNumber(crossRange[5]);
        if (startMonth && endMonth) {
          const startYear = inferredEventYear(Number(crossRange[1]), startMonth, crossRange[3]);
          const endYear = crossRange[6]
            ? Number(crossRange[6])
            : startMonth > endMonth
              ? startYear + 1
              : startYear;
          const startDate = eventIsoDate(Number(crossRange[1]), startMonth, startYear);
          const endDate = eventIsoDate(Number(crossRange[4]), endMonth, endYear);
          if (startDate && endDate && endDate >= startDate) ranges.push({ startDate, endDate });
        }
      }

      const sameMonthRange = line.match(sameMonthRangeRegex);
      if (sameMonthRange) {
        const month = eventMonthNumber(sameMonthRange[3]);
        if (month) {
          const year = inferredEventYear(Number(sameMonthRange[1]), month, sameMonthRange[4]);
          const startDate = eventIsoDate(Number(sameMonthRange[1]), month, year);
          const endDate = eventIsoDate(Number(sameMonthRange[2]), month, year);
          if (startDate && endDate && endDate >= startDate) ranges.push({ startDate, endDate });
        }
      }

      const pairedDates = line.match(pairedDatesRegex);
      if (pairedDates) {
        addCandidate(pairedDates[1], pairedDates[3], pairedDates[4], pairedDates[5], pairedDates[6]);
        addCandidate(pairedDates[2], pairedDates[3], pairedDates[4], pairedDates[5], pairedDates[6]);
      }

      singleDateRegex.lastIndex = 0;
      for (const match of line.matchAll(singleDateRegex)) {
        addCandidate(match[1], match[2], match[3], match[4], match[5]);
      }
    }

    const activeRange = ranges
      .filter((value) => value.endDate >= todayIso)
      .sort((left, right) =>
        left.startDate.localeCompare(right.startDate)
        || left.endDate.localeCompare(right.endDate)
      )[0] || null;

    const futureCandidates = candidates
      .filter((value) => value.date >= todayIso)
      .filter((value, index, all) =>
        all.findIndex((candidate) =>
          candidate.date === value.date && candidate.time === value.time
        ) === index
      )
      .sort((left, right) =>
        left.date.localeCompare(right.date)
        || String(left.time || "").localeCompare(String(right.time || ""))
      );

    const distinctFutureDates = futureCandidates
      .map((value) => value.date)
      .filter((value, index, all) => all.indexOf(value) === index);

    return {
      rangeStartDate: activeRange?.startDate || null,
      rangeEndDate: activeRange?.endDate || null,
      firstFutureDate: distinctFutureDates[0] || null,
      lastFutureDate: distinctFutureDates.at(-1) || null,
      firstFutureTime: futureCandidates[0]?.time || null,
      futureDateCount: distinctFutureDates.length,
    };
  };

  const visibleEventVenue = (lines, title) => {
    const label = /^(?:место проведения|площадка|где(?: проходит)?|адрес)$/i;
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (!label.test(lines[index])) continue;
      for (let offset = 1; offset <= 3; offset += 1) {
        const candidate = lines[index + offset];
        if (!candidate || candidate === title) continue;
        if (/^(?:адрес|цена|расписание|купить|билеты)/i.test(candidate)) continue;
        if (candidate.length >= 2 && candidate.length <= 240) return candidate;
      }
    }
    for (const selector of [
      '[data-testid*="venue" i]',
      '[class*="venue" i]',
      '[class*="event-place" i]',
      'a[href*="/place/"]',
      'a[href*="/places/"]',
      'a[href*="/venue/"]',
    ]) {
      const value = text(selector);
      if (value && value !== title && value.length <= 240) return value;
    }
    return null;
  };

  const eventExternalId = (source, category, startDate, startTime, venueName) => {
    if (category !== "concert" || !startDate) return source.externalId;
    const venueKey = encodeURIComponent(
      cleanText(venueName || "").toLocaleLowerCase("ru-RU"),
    ).slice(0, 120);
    return [
      source.externalId,
      startDate,
      startTime || "",
      venueKey,
    ].join("::").slice(0, 500);
  };

  function captureIdentity(item) {
    return item?.kind === "event"
      ? ["event", item?.sourceProvider || "", item?.externalId || item?.sourceUrl || ""].join(":")
      : item?.sourceUrl || "";
  }

  const kassirEventCapture = () => {
    try {
      const source = eventProviderSource();
      if (!source || source.provider !== "kassir") return null;

      const title =
        text("h1") ||
        meta('meta[property="og:title"]')
          .replace(/\s*[—|-]\s*KASSIR\.RU.*$/i, "")
          .trim() ||
        cleanText(document.title)
          .replace(/\s*[—|-]\s*KASSIR\.RU.*$/i, "")
          .trim();
      if (!title) return null;

      const category = eventCategory(source, [], []);
      const eventLines = visibleEventLines();
      const city =
        cityFromSlug(source.citySlug) ||
        (() => {
          const body = eventLines.slice(0, 120).join(" ");
          for (const value of [
            "Москва","Санкт-Петербург","Казань","Екатеринбург","Новосибирск",
            "Нижний Новгород","Самара","Уфа","Пермь","Челябинск","Краснодар",
            "Ростов-на-Дону","Воронеж","Омск","Тюмень",
          ]) {
            if (body.includes(value)) return value;
          }
          return null;
        })();

      const venueName =
        visibleEventVenue(eventLines, title) ||
        text('[class*="venue" i]') ||
        text('[class*="place" i]') ||
        null;

      const description =
        meta('meta[name="description"]') ||
        meta('meta[property="og:description"]') ||
        cleanText(
          document.querySelector(
            'main p, article p, [class*="description" i] p, [class*="description" i]',
          )?.textContent || "",
        ).slice(0, 4000) ||
        null;

      const imageUrl = (() => {
        const value =
          meta('meta[property="og:image:secure_url"]') ||
          meta('meta[property="og:image"]') ||
          meta('meta[name="twitter:image"]');
        if (value) {
          try {
            const url = new URL(value, location.href);
            if (url.protocol === "https:") return url.href;
          } catch {}
        }
        return visibleEventImage();
      })();

      const activityType = eventActivityType(source, [], title);
      const schedule = resolvedEventSchedule(source, category, null, eventLines, title);
      const startDate = schedule.startDate;
      const endDate = schedule.endDate;
      const startTime = schedule.startTime;
      const occurrenceType =
        category === "activity"
          ? endDate && startDate && endDate !== startDate
            ? "date_range"
            : startDate
              ? "fixed_event"
              : ["museum","park","landmark","architecture","history","nature","viewpoint"].includes(activityType)
                ? "permanent_attraction"
                : "recurring_booking"
          : null;

      const price = eventPriceRange(null, source, eventLines, title);
      const externalId = eventExternalId(
        source,
        category,
        startDate,
        startTime,
        venueName,
      );

      return {
        kind: "event",
        category,
        sourceProvider: "kassir",
        sourceUrl: source.sourceUrl,
        externalId,
        title,
        imageUrl,
        description,
        country: city ? "Россия" : null,
        city,
        venueName,
        address: null,
        startDate,
        endDate,
        startTime,
        priceMin: price.priceMin,
        priceMax: price.priceMax,
        currency: price.currency,
        tags: [
          source.providerCategory,
          category === "concert" ? "концерт" : activityType,
        ].filter(Boolean),
        activityType: category === "activity" ? activityType : null,
        occurrenceType,
        artistName: category === "concert" ? title : null,
        capturedAt: Date.now(),
      };
    } catch {
      return null;
    }
  };

  const resolvedEventSchedule = (source, category, entity, eventLines, title) => {
    const now = new Date();
    const todayIso = [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");

    const start = isoDateParts(entity?.startDate);
    const end = isoDateParts(entity?.endDate);
    const domDates = domEventDateTimes();
    const providerLines = providerEventScheduleLines(source, eventLines, title);
    const monthLines = eventLines.filter((line) =>
      /(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.test(line),
    ).slice(0, 180);
    const visibleDate = russianEventDateInfo(
      providerLines.length
        ? providerLines
        : [
            ...eventScheduleTexts(source.provider),
            ...monthLines,
          ],
    );

    if (
      category === "activity"
      && visibleDate.rangeStartDate
      && visibleDate.rangeEndDate
    ) {
      return {
        startDate: visibleDate.rangeStartDate,
        endDate: visibleDate.rangeEndDate,
        startTime: null,
      };
    }

    if (visibleDate.firstFutureDate) {
      if (
        category === "activity"
        && visibleDate.futureDateCount > 1
        && visibleDate.lastFutureDate
      ) {
        return {
          startDate: visibleDate.firstFutureDate,
          endDate: visibleDate.lastFutureDate,
          startTime: null,
        };
      }
      return {
        startDate: visibleDate.firstFutureDate,
        endDate: null,
        startTime: visibleDate.firstFutureTime,
      };
    }

    const explicitEntityRange =
      category === "activity"
      && start.date
      && end.date
      && end.date !== start.date
      && end.date >= todayIso
        ? { startDate: start.date, endDate: end.date }
        : null;

    const future = [
      start.date && start.date >= todayIso ? start : null,
      ...domDates,
    ]
      .filter(Boolean)
      .filter((value, index, all) =>
        all.findIndex((candidate) =>
          candidate.date === value.date && candidate.time === value.time
        ) === index
      )
      .sort((left, right) =>
        left.date.localeCompare(right.date)
        || String(left.time || "").localeCompare(String(right.time || ""))
      );

    const distinctDates = future
      .map((value) => value.date)
      .filter((value, index, all) => all.indexOf(value) === index);

    if (explicitEntityRange) {
      return {
        startDate: explicitEntityRange.startDate,
        endDate: explicitEntityRange.endDate,
        startTime: null,
      };
    }
    if (category === "activity" && distinctDates.length > 1) {
      return {
        startDate: distinctDates[0],
        endDate: distinctDates.at(-1),
        startTime: null,
      };
    }
    return {
      startDate: distinctDates[0] || null,
      endDate: null,
      startTime: future[0]?.time || null,
    };
  };

  const eventCapture = () => {
    const source = eventProviderSource();
    if (!source) return null;

    const entity = ldEventEntity();
    const breadcrumbs = eventBreadcrumbs();
    const types = ldTypeValues(entity);
    const category = eventCategory(source, types, breadcrumbs);

    const title =
      cleanText(entity?.name || "") ||
      text("h1") ||
      meta('meta[property="og:title"]')
        .replace(/\s*[—|-]\s*(?:Яндекс\s*Афиша|KASSIR\.RU|KudaGo).*$/i, "")
        .trim() ||
      cleanText(document.title)
        .replace(/\s*[—|-]\s*(?:Яндекс\s*Афиша|KASSIR\.RU|KudaGo).*$/i, "")
        .trim();
    if (!title) return null;

    const description =
      cleanText(entity?.description || "") ||
      meta('meta[name="description"]') ||
      meta('meta[property="og:description"]') ||
      cleanText(
        document.querySelector(
          'main p, article p, [class*="description" i] p, [class*="description" i]',
        )?.textContent || "",
      ).slice(0, 4000) ||
      null;

    const imageUrl =
      ldImageUrl(entity) ||
      (() => {
        const value =
          meta('meta[property="og:image:secure_url"]') ||
          meta('meta[property="og:image"]') ||
          meta('meta[name="twitter:image"]');
        if (!value) return visibleEventImage();
        try {
          const url = new URL(value, location.href);
          return url.protocol === "https:" ? url.href : visibleEventImage();
        } catch {
          return visibleEventImage();
        }
      })();

    const locationData = ldAddressParts(entity);
    const city = locationData.city || cityFromSlug(source.citySlug);
    const country = locationData.country || (city ? "Россия" : null);
    const eventLines = visibleEventLines();
    const venueName =
      locationData.venueName ||
      text('[itemprop="location"]') ||
      text('[class*="place" i] [class*="title" i]') ||
      visibleEventVenue(eventLines, title) ||
      null;

    const schedule = resolvedEventSchedule(source, category, entity, eventLines, title);
    const startDate = schedule.startDate;
    const endDate = schedule.endDate;
    const startTime = schedule.startTime;

    const bodyStart = cleanText(document.body?.innerText || "").slice(0, 6000);
    const activityType = eventActivityType(source, breadcrumbs, title);
    const permanentActivityTypes = [
      "museum","park","landmark","architecture","history","nature","viewpoint",
    ];
    const occurrenceType =
      startDate && endDate && endDate !== startDate
        ? "date_range"
        : startDate
          ? "fixed_event"
          : source.providerCategory === "place"
            ? (
                permanentActivityTypes.includes(activityType)
                  ? "permanent_attraction"
                  : "recurring_booking"
              )
            : /круглый год/i.test(bodyStart)
              ? (
                  permanentActivityTypes.includes(activityType)
                    ? "permanent_attraction"
                    : "recurring_booking"
                )
              : (
                  permanentActivityTypes.includes(activityType)
                    ? "permanent_attraction"
                    : "recurring_booking"
                );

    const rawGenres = entity?.genre;
    const genres = (Array.isArray(rawGenres) ? rawGenres : typeof rawGenres === "string" ? rawGenres.split(",") : [])
      .map((value) => cleanText(String(value || "")))
      .filter(Boolean);
    const keywords = meta('meta[name="keywords"]')
      .split(",")
      .map((value) => cleanText(value))
      .filter(Boolean);
    const tags = [...genres, ...breadcrumbs.slice(-3), activityType]
      .concat(keywords.slice(0, 8))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 24);

    const performerRaw = entity?.performer ?? entity?.performers;
    const performerNames = ldPeopleNames(performerRaw, 6);
    const artistName = category === "concert"
      ? performerNames[0] || title
      : null;

    const price = eventPriceRange(entity, source, eventLines, title);

    // Keep the local recent card even when a provider renders some canonical
    // fields only after hydration. Strict validation remains on promotion.
    const externalId = eventExternalId(
      source,
      category,
      startDate,
      startTime,
      venueName,
    );

    return {
      kind: "event",
      category,
      sourceProvider: source.provider,
      sourceUrl: source.sourceUrl,
      externalId,
      title,
      imageUrl,
      description,
      country,
      city,
      venueName,
      address: locationData.address || null,
      startDate,
      endDate,
      startTime,
      priceMin: price.priceMin,
      priceMax: price.priceMax,
      currency: price.currency,
      tags: tags.length ? tags : [category === "concert" ? "концерт" : "активити"],
      activityType: category === "activity" ? activityType : null,
      occurrenceType: category === "activity" ? occurrenceType : null,
      artistName,
      capturedAt: Date.now(),
    };
  };



  
  const tripComUrlCandidates = () => {
    const values = [
      location.href,
      document.querySelector('link[rel="canonical"]')?.href || "",
      meta('meta[property="og:url"]'),
    ];
    const result = [];
    for (const value of values) {
      if (!value) continue;
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== "https:") continue;
        if (result.some((item) => item.href === url.href)) continue;
        result.push(url);
      } catch {}
    }
    return result;
  };

  const tripComSource = () => {
    let tripHostSeen = false;
    for (const url of tripComUrlCandidates()) {
      const sourceHost = url.hostname.toLowerCase();
      const host = sourceHost.replace(/^www\./, "");
      if (host !== "trip.com" && !host.endsWith(".trip.com")) continue;
      tripHostSeen = true;
      const path = url.pathname.replace(/\/+$/, "") || "/";

      const attraction = path.match(
        /^\/travel-guide\/attraction\/([^/]+)\/[^/]*-(\d+)$/i,
      );
      if (attraction) {
        return {
          entityType: "attraction",
          externalId: "attraction:" + attraction[2],
          sourceUrl: "https://" + sourceHost + path + "/",
          citySlug: attraction[1],
        };
      }

      const excursion = path.match(/^\/things-to-do\/detail\/(\d+)$/i);
      if (excursion) {
        return {
          entityType: "excursion",
          externalId: "experience:" + excursion[1],
          sourceUrl: "https://" + sourceHost + path + "/",
          citySlug: null,
        };
      }
    }

    if (tripHostSeen) {
      throw new Error(
        "Trip.com: пока поддерживаются только страницы достопримечательностей и экскурсий.",
      );
    }
    return null;
  };

  const tripComDecodeSeparatedText = (raw) => {
    const value = String(raw || "");
    const decode = (separator) => {
      const semanticMarker = "";
      const protectedValue = value
        .split(separator + separator + separator)
        .join(semanticMarker);
      const parts = protectedValue.split(separator);
      if (parts.length < 2) return null;

      const meaningful = [];
      for (const part of parts) {
        for (const fragment of part.split(semanticMarker)) {
          const cleanFragment = fragment.trim();
          if (cleanFragment) meaningful.push(cleanFragment);
        }
      }
      if (meaningful.length < 2) return null;

      const singleCharacterParts = meaningful.filter(
        (part) => Array.from(part).length <= 1,
      ).length;
      if (singleCharacterParts / meaningful.length < 0.8) return null;

      const hasLetters = meaningful.some((part) => /\p{L}/u.test(part));
      if (!hasLetters && meaningful.length < 4 && !value.includes(":")) {
        return null;
      }

      return parts
        .join("")
        .split(semanticMarker)
        .join(" " + separator + " ");
    };

    return decode("|") || decode("·") || value;
  };

  const tripComLines = () =>
    String(document.body?.innerText || "")
      .split(/\n+/)
      .map((value) => cleanText(tripComDecodeSeparatedText(value)))
      .filter(Boolean)
      .slice(0, 700);

  const tripComReadableSlug = (value) => {
    try {
      return decodeURIComponent(String(value || ""))
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .trim();
    } catch {
      return cleanText(String(value || "").replace(/[-_]+/g, " "));
    }
  };

  const tripComMetaImage = () => {
    const candidates = [
      meta('meta[property="og:image:secure_url"]'),
      meta('meta[property="og:image"]'),
      meta('meta[name="twitter:image"]'),
    ];
    for (const value of candidates) {
      if (!value) continue;
      try {
        const url = new URL(value, location.href);
        const hint = decodeURIComponent(url.pathname).toLowerCase();
        if (
          url.protocol === "https:"
          && !hint.includes("[object object]")
          && !/(?:logo|sprite|icon|favicon)/i.test(hint)
        ) {
          return url.href;
        }
      } catch {}
    }
    return null;
  };

  const tripComImage = () => {
    const candidates = [
      tripComMetaImage(),
      ...jsonLdEntities().map((entity) => ldImageUrl(entity)).filter(Boolean),
    ];
    for (const value of candidates) {
      if (!value) continue;
      try {
        const url = new URL(value, location.href);
        if (url.protocol === "https:" && !decodeURIComponent(url.pathname).includes("[object Object]")) {
          return url.href;
        }
      } catch {}
    }

    let best = null;
    let bestScore = -1;
    for (const img of document.querySelectorAll("main img, article img, img")) {
      const raw =
        img.currentSrc
        || img.src
        || img.getAttribute("data-src")
        || img.getAttribute("data-original")
        || "";
      if (!raw) continue;
      const hint = [
        raw,
        img.alt || "",
        img.getAttribute("class") || "",
      ].join(" ").toLowerCase();
      if (/(logo|icon|sprite|avatar|flag|qr|rating|star|badge)/i.test(hint)) continue;

      let resolved;
      try {
        resolved = new URL(raw, location.href);
      } catch {
        continue;
      }
      if (resolved.protocol !== "https:") continue;

      const rect = img.getBoundingClientRect();
      const width = Math.max(rect.width || 0, img.naturalWidth || 0);
      const height = Math.max(rect.height || 0, img.naturalHeight || 0);
      if (width < 240 || height < 140) continue;

      const area = width * height;
      const score =
        area
        + (/attraction|poi|travel|scene|image/i.test(resolved.pathname) ? 500000 : 0)
        + (rect.top >= -200 && rect.top <= window.innerHeight * 1.5 ? 250000 : 0);
      if (score <= bestScore) continue;
      best = resolved.href;
      bestScore = score;
    }
    return best;
  };

  const tripComExcursionImage = () => {
    const metaImage = tripComMetaImage();
    if (metaImage) return metaImage;

    for (const img of document.querySelectorAll("main img, article img, img")) {
      const raw =
        img.currentSrc
        || img.src
        || img.getAttribute("data-src")
        || img.getAttribute("data-original")
        || "";
      if (!raw) continue;

      const hint = [raw, img.alt || "", img.getAttribute("class") || ""]
        .join(" ")
        .toLowerCase();
      if (/(logo|icon|sprite|avatar|flag|qr|rating|star|badge|payment)/i.test(hint)) continue;

      let resolved;
      try { resolved = new URL(raw, location.href); } catch { continue; }
      if (resolved.protocol !== "https:") continue;

      const rect = img.getBoundingClientRect();
      const width = Math.max(rect.width || 0, img.naturalWidth || 0);
      const height = Math.max(rect.height || 0, img.naturalHeight || 0);
      if (width < 320 || height < 180) continue;

      return resolved.href;
    }

    return tripComImage();
  };

  const tripComCleanPageTitle = (value) =>
    cleanText(value || "")
      .replace(/\s*[|–—-]\s*Trip\.com.*$/i, "")
      .replace(/^Trip\.com\s*[|–—-]\s*/i, "")
      .trim();

  const tripComMetaTitle = () =>
    tripComCleanPageTitle(meta('meta[property="og:title"]'))
    || tripComCleanPageTitle(meta('meta[name="twitter:title"]'))
    || tripComCleanPageTitle(document.title);

  const tripComTitle = () => {
    const directTitle = cleanText(document.querySelector("h1")?.textContent || "");
    if (directTitle) return directTitle;

    const blockedHeading = /^(?:Правила посещения|Инструкция по проверке|Подробнее|Забронировать|Отзывы и информация|Неподалеку|Карта|Открыто|Закрыто|Ограничения посещения|Особенности услуги|Варианты тура|Информация об услуге|Маршрут|Услуги|Reviews?|Map|Open|Closed)$/i;
    for (const node of document.querySelectorAll("h1, h2, h3, [role=heading]")) {
      const value = cleanText(node.textContent || "");
      if (!value || value.length < 3 || value.length > 500) continue;
      if (blockedHeading.test(value)) continue;
      if (/^(?:[1-5](?:[.,]\d)?\s*\/\s*5|\d+[.,]?\d*|[₽$€£¥]+)$/.test(value)) continue;
      return value;
    }

    const structuredTitle = jsonLdEntities()
      .map((entity) => cleanText(entity?.name || entity?.headline || ""))
      .find((value) => value.length >= 3 && value.length <= 500);
    return structuredTitle || tripComMetaTitle();
  };

  const tripComExcursionTitle = (lines, breadcrumbs) => {
    const navigation = /^(?:Главная|Экскурсии и билеты|Экскурсии|Групповые экскурсии|Things to do|Local experiences)$/i;
    const blocked = /^(?:Особенности услуги|Пакет и цена|Маршрут|Отзывы|Правила и условия|Популярные развлечения|Хиты продаж|Выбрать пакет|Варианты тура|Информация об услуге|Отмена с условиями|Как пользоваться|Примечания|Вопросы и ответы|ID услуги\s*:)/i;
    const routeSummary = /(?:^\d+\s+(?:достопримечательност(?:ей|и)|attractions?)|Достопримечательности и мероприятия|Достопримечательности и представления|Attractions and activities|Входные билеты не включены|Admission tickets? not included)/i;
    const packageLabel = /^(?:(?:индивидуальная|частная)\s+экскурсия|экскурсия\s+с\s+присоединением\s+к\s+группе|групповая\s+экскурсия|private\s+tour|join-in\s+tour|group\s+tour)(?:\s*[,·/\-–—]\s*[^+]{1,100})?$/i;
    const shareNoise = /^(?:Срок действия|Установите приложение Trip\.com|Получите доступ к эксклюзивным ценам|Скачать|Подробнее|Новый пользователь|Получить|Бронируйте сейчас|Подтверждение бронирования|Отмена с условиями|Бесплатная отмена|Языки обслуживания|От|From)$/i;

    const isProductTitle = (rawValue) => {
      const value = cleanText(rawValue || "");
      return value.length >= 12
        && value.length <= 500
        && !navigation.test(value)
        && !blocked.test(value)
        && !routeSummary.test(value)
        && !packageLabel.test(value)
        && !shareNoise.test(value)
        && !/^(?:\d+|[₽$€£¥]+)$/.test(value);
    };

    const breadcrumbCandidate = [...breadcrumbs].reverse().find(isProductTitle);
    if (breadcrumbCandidate) return cleanText(breadcrumbCandidate);

    for (const node of document.querySelectorAll("h1, h2, h3, [role=heading]")) {
      const value = cleanText(node.textContent || "");
      if (isProductTitle(value)) return value;
    }

    const jsonLdCandidate = jsonLdEntities()
      .map((entity) => cleanText(entity?.name || entity?.headline || ""))
      .find(isProductTitle);
    if (jsonLdCandidate) return jsonLdCandidate;

    const metaCandidate = tripComMetaTitle();
    if (metaCandidate && isProductTitle(metaCandidate)) return metaCandidate;

    const featureIndex = lines.findIndex((line) =>
      /^(?:Особенности услуги|Highlights|Основные моменты|Что вас ожидает)$/i.test(line)
    );
    const earlyLimit = featureIndex >= 0 ? Math.min(featureIndex, 60) : 32;
    const earlyCandidate = lines.slice(0, earlyLimit).find(isProductTitle);
    return earlyCandidate ? cleanText(earlyCandidate) : null;
  };

  const tripComExcursionPackageTags = (lines) => {
    const body = lines.slice(0, 220).join(" ");
    const tags = [];
    if (/(?:Индивидуальная экскурсия|Частная экскурсия|Private tour)/i.test(body)) {
      tags.push("индивидуальная экскурсия");
    }
    if (/(?:Экскурсия с присоединением к группе|Групповая экскурсия|Join-in tour|Group tour)/i.test(body)) {
      tags.push("групповая экскурсия");
    }
    return tags;
  };

  const tripComLabelValue = (lines, patterns, limit = 300) => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const pattern of patterns) {
        const inline = line.match(pattern);
        if (!inline) continue;
        const inlineValue = cleanText(inline[1] || "");
        if (inlineValue && inlineValue.length <= limit) return inlineValue;
        const next = cleanText(lines[index + 1] || "");
        if (next && next.length <= limit) return next;
      }
    }
    return null;
  };

  const tripComHighlights = (lines) => {
    const headings = /(?:^|:\s*)(?:Highlights|Основные моменты|Что вас ожидает|Особенности(?: услуги)?)(?:$|\s*[:：])/i;
    const stop = /^(?:Itinerary|Маршрут|What's included|Что включено|Important information|Важная информация|Meeting point|Место встречи|Reviews?|Отзывы|About|Об объекте|Opening hours|Часы работы|Пакет и цена|Дата использования|Выберите пакет|Package and price|Date of use|Подробнее|Варианты тура|Информация об услуге|Услуги)$/i;
    const index = lines.findIndex((line) => headings.test(line));
    if (index < 0) return [];
    const values = [];
    for (const line of lines.slice(index + 1, index + 12)) {
      if (stop.test(line)) break;
      if (line.length < 12 || line.length > 240) continue;
      if (!values.includes(line)) values.push(line);
      if (values.length >= 5) break;
    }
    return values;
  };

  const tripComExcursionItinerary = (lines) => {
    const cleanRouteLine = (raw) =>
      cleanText(tripComDecodeSeparatedText(raw))
        .replace(/\s*\|\s*/g, " · ")
        .replace(
          /(\d+\s+достопримечательност(?:ей|и))(?=[A-ZА-ЯЁ])/gu,
          "$1 · ",
        )
        .replace(
          /(\d+\s+attractions?)(?=[A-Z])/gi,
          "$1 · ",
        )
        .replace(/(?=Входные билеты не включены\s*:)/gi, " · ")
        .replace(/(?=Admission tickets? not included\s*:)/gi, " · ")
        .replace(/(?:\s*·\s*){2,}/g, " · ")
        .replace(/^·\s*|\s*·$/g, "")
        .trim();

    const collectFrom = (start, includeStart = false) => {
      const values = [];
      const stop = /^(?:Услуги|Services|Пакет и цена|Package and price|Популярно в категории|Popular in category|Рекомендуемые направления|Recommended destinations|ID услуги\s*:|Service ID\s*:)/i;
      const controls = /^(?:Свернуть|Развернуть|Подробнее|Показать все|Collapse|Expand|More)$/i;
      const sliceStart = includeStart ? start : start + 1;

      for (const raw of lines.slice(sliceStart, sliceStart + 80)) {
        let line = cleanRouteLine(raw);
        if (!line) continue;

        if (includeStart) {
          const inlineRouteStart = line.search(
            /(?:Достопримечательности и мероприятия|Достопримечательности и представления|Attractions and activities|\b\d+\s+(?:достопримечательност(?:ей|и)|attractions?))/i,
          );
          if (inlineRouteStart > 0) {
            line = cleanText(line.slice(inlineRouteStart));
          }
        }

        const inlineStop = line.search(/(?:^|\s)(?:Услуги|Services|Популярно в категории|Popular in category|Рекомендуемые направления|Recommended destinations|ID услуги\s*:|Service ID\s*:)(?=\s|$)/i);
        if (inlineStop === 0) break;
        if (inlineStop > 0) line = cleanRouteLine(line.slice(0, inlineStop));
        if (!line) break;

        if (stop.test(line)) break;
        if (controls.test(line)) continue;
        if (/^(?:Маршрут|Itinerary)$/i.test(line)) continue;
        if (line.length > 1400) continue;
        values.push(line);
        if (values.join(" · ").length >= 3800) break;
        if (inlineStop > 0) break;
      }

      const textValue = cleanText(values.join(" · "));
      return textValue.length >= 30 ? textValue.slice(0, 4000) : null;
    };

    const routeStart = lines.findIndex((line) => /^(?:Маршрут|Itinerary)$/i.test(line));
    if (routeStart >= 0) {
      const desktopRoute = collectFrom(routeStart);
      if (desktopRoute) return desktopRoute;
    }

    const mobileStart = lines.findIndex((line) =>
      /^(?:Достопримечательности и мероприятия|Достопримечательности и представления|Attractions and activities)$/i.test(line)
      || /^\d+\s+(?:достопримечательност(?:ей|и)|attractions?)/i.test(line)
      || /(?:Входные билеты не включены|Admission tickets? not included)/i.test(line)
    );
    if (mobileStart >= 0) {
      const headingOnly = /^(?:Достопримечательности и мероприятия|Достопримечательности и представления|Attractions and activities)$/i.test(lines[mobileStart]);
      const mobileRoute = collectFrom(mobileStart, !headingOnly);
      if (mobileRoute) return mobileRoute;
    }

    return null;
  };

  const tripComLooksHumanText = (value) => {
    const textValue = cleanText(value || "");
    if (textValue.length < 35 || textValue.length > 4000) return false;
    if (/^(?:[A-F0-9]{24,}\s*)+$/i.test(textValue)) return false;
    if (/^[A-Za-z0-9_-]{48,}$/.test(textValue)) return false;
    const words = textValue.split(/\s+/).filter(Boolean);
    if (words.length < 5) return false;
    const letters = textValue.match(/\p{L}/gu)?.length || 0;
    if (letters < 18 || letters / textValue.length < 0.22) return false;
    return true;
  };

  const tripComPopularReview = (lines) => {
    const headingIndex = lines.findIndex((line) =>
      /(?:отзыв(?:ы|ов)?.*(?:посетител|путешествен)|reviews?.*(?:visitor|traveler)|other visitors' reviews)/i.test(line)
    );
    const qualityPattern = /^(?:превосходно|отлично|очень хорошо|хорошо|плохо|outstanding|excellent|very good|good|poor)$/i;
    const qualityIndex = lines.findIndex((line, index) =>
      index >= Math.max(0, headingIndex)
      && index < Math.max(headingIndex + 24, 120)
      && qualityPattern.test(line)
    );
    const startIndex =
      qualityIndex >= 0 ? qualityIndex + 1
      : headingIndex >= 0 ? headingIndex + 1
      : -1;
    if (startIndex < 0) return null;

    const hardBoundary = /(?:Больше развлечений|More Things To Do|Trip Select|От партнера|Official listing|Сегодня|Today|Завтра|Tomorrow|Выберите дату|Select date|Входные билеты|Admission tickets|Однодневные туры|Day tours|Пакет и цена|Package and price)/i;
    const reviewBoundary = /^(?:Показать все|Show all|Отзыв оставлен|Reviewed on|Текст оригинала|Original text|увидеть больше отзывов|see more reviews)/i;
    const seoNoise = /(?:Trip\.com|бронируйте|забронируйте|узнавайте цены|проверяйте актуальные часы|popular photos|популярные фотографии)/i;
    const values = [];
    let started = false;

    for (const rawLine of lines.slice(startIndex, startIndex + 24)) {
      let line = cleanText(rawLine);
      if (!line) continue;
      if (started && reviewBoundary.test(line)) break;

      const boundaryIndex = line.search(hardBoundary);
      if (boundaryIndex === 0 && started) break;
      if (boundaryIndex > 0) line = cleanText(line.slice(0, boundaryIndex));
      if (!line) break;
      if (qualityPattern.test(line) || seoNoise.test(line) || reviewBoundary.test(line)) continue;
      if (!tripComLooksHumanText(line) && !started) continue;
      if (!tripComLooksHumanText(line) && started) break;

      started = true;
      values.push(line);
      if (boundaryIndex >= 0 || values.join(" ").length >= 4000) break;
    }

    const review = cleanText(values.join(" "));
    return tripComLooksHumanText(review) ? review.slice(0, 4000) : null;
  };

  const tripComDescription = (lines, highlights, title) => {
    const metadata = [
      meta('meta[name="description"]'),
      meta('meta[property="og:description"]'),
    ]
      .map((value) => cleanText(tripComDecodeSeparatedText(value)))
      .find((value) =>
        value.length >= 30
        && value.length <= 4000
        && !/^(?:Trip\.com|Book hotels|Find cheap flights)/i.test(value)
      );
    if (metadata) return metadata.slice(0, 4000);

    const highlightText = highlights.join(" · ");
    if (highlightText.length >= 30) return highlightText.slice(0, 4000);

    const paragraphs = [
      ...document.querySelectorAll(
        'main [class*="highlight" i], main [class*="description" i], main [class*="intro" i], main p, article p',
      ),
    ]
      .map((node) => cleanText(tripComDecodeSeparatedText(node.textContent || "")))
      .filter((value) =>
        value.length >= 40
        && value.length <= 1200
        && value !== title
        && !/(?:cookie|privacy|sign in|log in|download app)/i.test(value)
      );
    return paragraphs[0] || null;
  };

  const tripComMoney = (raw) => {
    const value = cleanText(raw || "");
    if (!value) return null;
    const currencyCode = value.match(/\b(USD|EUR|GBP|RUB|CNY|JPY|KRW|HKD|AUD|CAD|SGD|AED|TRY|KZT)\b/i)?.[1]?.toUpperCase();
    const symbol = value.match(/[€£$¥₽]/)?.[0] || null;
    const currency = currencyCode || (
      symbol === "€" ? "EUR"
      : symbol === "£" ? "GBP"
      : symbol === "¥" ? "CNY"
      : symbol === "₽" ? "RUB"
      : symbol === "$" ? "USD"
      : null
    );
    const amountMatch = value.match(/(\d[\d\s,.]*\d|\d)/);
    if (!amountMatch || !currency) return null;
    let amountText = amountMatch[1].replace(/\s+/g, "");
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(amountText)) {
      amountText = amountText.replace(/,/g, "");
    } else if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(amountText)) {
      amountText = amountText.replace(/\./g, "").replace(",", ".");
    } else if (amountText.includes(",") && !amountText.includes(".")) {
      amountText = amountText.replace(",", ".");
    } else {
      amountText = amountText.replace(/,/g, "");
    }
    const amount = Number(amountText);
    return Number.isFinite(amount) && amount > 0 && amount < 100000000
      ? { amount, currency }
      : null;
  };

  const tripComAttractionPrice = (lines) => {
    const top = lines.slice(0, 140);
    if (top.some((line) =>
      /^(?:Вход свободный|Бесплатный вход|Вход бесплатный|Free admission|Free entry)$/i.test(line)
    )) {
      return null;
    }

    for (const line of top) {
      if (!/(?:стоимость билета|цена билета|входной билет|admission price|ticket price)/i.test(line)) {
        continue;
      }
      const parsed = tripComMoney(line);
      if (parsed) return parsed;
    }
    return null;
  };

  const tripComExcursionPrice = (lines) => {
    const top = lines.slice(0, 160);
    for (let index = 0; index < top.length; index += 1) {
      const line = top[index];
      if (/^(?:From|От|Цена от)$/i.test(line)) {
        const parsed = tripComMoney(top[index + 1]) || tripComMoney(top[index + 2]);
        if (parsed) return parsed;
      }
      if (/^(?:From|От|Цена от)\s+/i.test(line)) {
        const parsed = tripComMoney(line);
        if (parsed) return parsed;
      }
    }
    return null;
  };

  const tripComRating = (lines) => {
    const top = lines.slice(0, 180);
    for (let index = 0; index < top.length; index += 1) {
      const line = top[index];
      const reviews = line.match(/([\d,.]+)\s*(?:reviews?|отзыв(?:а|ов)?)/i);
      if (!reviews) continue;
      const count = Number(reviews[1].replace(/[^\d]/g, ""));
      const ratingCandidates = [line, top[index - 1] || ""];
      let rating = null;
      for (const candidate of ratingCandidates) {
        const match = candidate.match(/(?:^|\s)([1-5](?:[.,]\d)?)\s*(?:\/\s*5)?(?:\s|$)/);
        if (!match) continue;
        const parsed = Number(match[1].replace(",", "."));
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5) {
          rating = parsed;
          break;
        }
      }
      return {
        rating,
        reviewCount: Number.isFinite(count) && count >= 0 ? count : null,
      };
    }
    return { rating: null, reviewCount: null };
  };

  const tripComBreadcrumbs = () =>
    uniqueTexts(
      document.querySelectorAll(
        '[class*="breadcrumb" i] a, [class*="breadcrumb" i] span, nav[aria-label*="breadcrumb" i] a',
      ),
      16,
    ).filter((value) =>
      value.length >= 2
      && value.length <= 500
      && !/^(?:Home|Trip\.com|Things to do|Attractions|Travel Guide)$/i.test(value)
    );

  const tripComActivityType = (title, description) => {
    const primary = [title, description].join(" ");
    if (/museum|музей/i.test(primary)) return "museum";
    if (/cathedral|church|palace|castle|architecture|собор|церков|дворец|замок|архитект/i.test(primary)) return "architecture";
    if (/viewpoint|observation|панорам|смотров/i.test(primary)) return "viewpoint";
    if (/nature|waterfall|mountain|beach|природ|водопад|гора|пляж/i.test(primary)) return "nature";
    if (/park|garden|парк|сад/i.test(primary)) return "park";
    if (/history|historic|ancient|истор|древн/i.test(primary)) return "history";
    return "landmark";
  };

  const tripComActivityTagRu = (activityType) => {
    if (activityType === "museum") return "музей";
    if (activityType === "park") return "парк";
    if (activityType === "viewpoint") return "смотровая площадка";
    if (activityType === "nature") return "природа";
    if (activityType === "architecture") return "архитектура";
    if (activityType === "history") return "история";
    return "достопримечательность";
  };

  const tripComTags = (values) =>
    ["Trip.com", ...values]
      .map((value) => cleanText(value))
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 12);

  const tripComStructuredAddress = () => {
    for (const entity of jsonLdEntities()) {
      const address = entity?.address;
      if (typeof address === "string") {
        const value = cleanText(address);
        if (value.length >= 5 && value.length <= 500) return value;
      }
      if (!address || typeof address !== "object") continue;
      const value = [
        address.streetAddress,
        address.addressLocality,
        address.addressRegion,
        address.addressCountry?.name || address.addressCountry,
      ]
        .map((part) => cleanText(part || ""))
        .filter(Boolean)
        .filter((part, index, all) => all.indexOf(part) === index)
        .join(", ");
      if (value.length >= 5 && value.length <= 500) return value;
    }
    return null;
  };

  const tripComAttractionAddress = (lines) => {
    const labeled = tripComLabelValue(lines, [
      /Address\s*[:：]\s*(.*)$/i,
      /Адрес\s*[:：]\s*(.*)$/i,
    ], 500);
    if (labeled) return labeled;

    const structured = tripComStructuredAddress();
    if (structured) return structured;

    for (const node of document.querySelectorAll(
      '[class*="address" i], [data-testid*="address" i], [itemprop="address"]',
    )) {
      const value = cleanText(node.textContent || "");
      if (value.length >= 5 && value.length <= 500) return value;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const inline = lines[index].match(/^(.{5,300}?)\s+(?:Карта|Map)$/i);
      if (inline) return cleanText(inline[1]);

      if (!/^(?:Карта|Map)$/i.test(lines[index])) continue;
      for (let cursor = index - 1; cursor >= Math.max(0, index - 4); cursor -= 1) {
        const value = cleanText(lines[cursor] || "");
        if (value.length < 5 || value.length > 300) continue;
        if (/^(?:Открыто|Закрыто|Open|Closed|Ограничения посещения|No pets allowed)$/i.test(value)) continue;
        if (
          /,/.test(value)
          || /\b(?:district|city|province|county|street|road|avenue)\b/i.test(value)
          || /(?:район|город|область|улица|проспект|шоссе)/i.test(value)
        ) {
          return value;
        }
      }
    }

    return null;
  };

  const tripComExcursionCity = (lines, title, breadcrumbs) => {
    const boundary = "(?:Начало|Окончание|От(?=\\s|\\d|[₽$€£¥])|Цена|Пакет|Выберите|Забронировать|Услуги|Маршрут|Дата|Индивидуальная|Групповая|Частная|Особенности|Продолжительность|Длительность|Start|End|From(?=\\s|\\d|[₽$€£¥])|Price|Package|Services|Itinerary|Date|Private|Group|Highlights|Duration)";
    const extractDeparture = (value) => {
      const textValue = cleanText(tripComDecodeSeparatedText(value || ""));
      if (!textValue) return null;

      const patterns = [
        new RegExp(
          "Место отправления(?:\\s+для\\s+всех\\s+экскурсий)?\\s*[:：]?\\s*([\\p{L}][\\p{L} .'-]{1,80}?)(?=" + boundary + "|[;|]|$)",
          "iu",
        ),
        new RegExp(
          "Город отправления\\s*[:：]?\\s*([\\p{L}][\\p{L} .'-]{1,80}?)(?=" + boundary + "|[;|]|$)",
          "iu",
        ),
        new RegExp(
          "Отправление\\s+из(?:\\s+г\\.)?\\s*[:：]?\\s*([\\p{L}][\\p{L} .'-]{1,80}?)(?=" + boundary + "|[;|]|$)",
          "iu",
        ),
        new RegExp(
          "(?:Departs?\\s+from|Starting point|Departure point)\\s*[:：]?\\s*([\\p{L}][\\p{L} .'-]{1,80}?)(?=" + boundary + "|[;|]|$)",
          "iu",
        ),
      ];

      for (const pattern of patterns) {
        const match = textValue.match(pattern);
        const candidate = cleanText(match?.[1] || "")
          .replace(/[)）].*$/, "")
          .replace(/^(?:г\.|город)\s*/i, "")
          .trim();
        const candidateLower = candidate.toLocaleLowerCase();
        if (candidateLower.startsWith("для всех ") || candidateLower.startsWith("for all ")) continue;
        if (candidate && candidate.length <= 80) return candidate;
      }
      return null;
    };

    const departureLabelOnly = (value) => {
      const normalized = cleanText(value || "").toLocaleLowerCase();
      return normalized.startsWith("место отправления")
        || normalized.startsWith("город отправления")
        || normalized.startsWith("отправление из")
        || normalized.startsWith("departure point")
        || normalized.startsWith("starting point")
        || normalized.startsWith("departs from")
        || normalized.startsWith("depart from");
    };

    const blockedDepartureValue = (value) => {
      const normalized = cleanText(value || "").toLocaleLowerCase();
      return ["начало", "окончание", "цена", "пакет", "выберите", "забронировать", "услуги", "маршрут", "дата", "индивидуальная", "групповая", "частная", "особенности", "продолжительность", "длительность", "start", "end", "price", "package", "services", "itinerary", "date", "private", "group", "highlights", "duration"]
        .some((prefix) => normalized.startsWith(prefix));
    };

    for (let index = 0; index < Math.min(lines.length, 360); index += 1) {
      const line = lines[index];
      const candidate = extractDeparture(line);
      if (candidate) return candidate;

      if (!departureLabelOnly(line)) continue;
      const next = cleanText(lines[index + 1] || "");
      if (next && next.length <= 80 && !blockedDepartureValue(next)) return next;
    }

    const body = String(document.body?.innerText || "");
    const bodyCandidate = extractDeparture(body);
    if (bodyCandidate) return bodyCandidate;

    const decodedBody = cleanText(
      String(body)
        .split(/\n+/)
        .map((line) => tripComDecodeSeparatedText(line))
        .join(" "),
    );
    const decodedCandidate = extractDeparture(decodedBody);
    if (decodedCandidate) return decodedCandidate;

    const breadcrumbCity = breadcrumbs.find((value) =>
      /(?:Сан[-–— ]?Паулу|S[aã]o Paulo)/i.test(value)
    ) || null;

    const cityEvidence = [title, decodedBody, ...breadcrumbs].join(" ");
    const pageCity =
      /Сан[-–— ]?Паулу/i.test(cityEvidence) ? "Сан-Паулу"
      : /S[aã]o Paulo/i.test(cityEvidence) ? "Sao Paulo"
      : null;

    return breadcrumbCity || pageCity || null;
  };

  const tripComCapture = () => {
    const source = tripComSource();
    if (!source) return null;

    const lines = tripComLines();
    const breadcrumbs = tripComBreadcrumbs();
    const title =
      source.entityType === "excursion"
        ? (tripComExcursionTitle(lines, breadcrumbs) || tripComTitle())
        : tripComTitle();
    const imageUrl =
      source.entityType === "excursion"
        ? tripComExcursionImage()
        : tripComImage();
    const highlights = tripComHighlights(lines);
    const genericDescription = tripComDescription(lines, highlights, title);
    const popularReview = tripComPopularReview(lines);
    const rating = tripComRating(lines);

    if (source.entityType === "attraction") {
      const address = tripComAttractionAddress(lines);
      const durationText = tripComLabelValue(lines, [
        /Recommended sightseeing time\s*[:：]\s*(.*)$/i,
        /Recommended visit duration\s*[:：]\s*(.*)$/i,
        /Рекомендуемое время осмотра\s*[:：]\s*(.*)$/i,
        /Рекомендуемая продолжительность(?: посещения| осмотра)?\s*[:：]\s*(.*)$/i,
      ], 160);
      const cityFromUrl = tripComReadableSlug(source.citySlug);
      const cityAliases = [cityFromUrl, ...breadcrumbs]
        .map((value) => cleanText(value))
        .filter((value) => value && value.length <= 120)
        .filter((value, index, all) => all.indexOf(value) === index)
        .slice(0, 12);
      const city = cityAliases[0] || null;
      const countryCandidate = address?.split(",").at(-1)?.trim() || null;
      const country =
        countryCandidate
        && /^[\p{L} .'-]{2,80}$/u.test(countryCandidate)
        && !/\b(?:city|district|province|county|state)\b/i.test(countryCandidate)
        && !/(?:город|район|область|край)$/i.test(countryCandidate)
          ? countryCandidate
          : null;
      const resolvedDescription =
        popularReview
        || (
          title && city && address
            ? [title, "Достопримечательность Trip.com в " + city + ".", "Адрес: " + address].join(" ")
            : null
        );
      const activityType = tripComActivityType(title, resolvedDescription);
      const price = tripComAttractionPrice(lines);

      if (!title || !imageUrl || !resolvedDescription || resolvedDescription.length < 30 || !city || !address) {
        return null;
      }
      return {
        kind: "event",
        category: "activity",
        sourceProvider: "trip_com",
        sourceUrl: source.sourceUrl,
        externalId: source.externalId,
        title,
        imageUrl,
        description: resolvedDescription,
        country,
        city,
        cityAliases,
        venueName: title,
        address,
        startDate: null,
        endDate: null,
        startTime: null,
        priceMin: price?.amount ?? null,
        priceMax: null,
        currency: price?.currency ?? null,
        tags: tripComTags(["достопримечательность", tripComActivityTagRu(activityType)]),
        activityType,
        occurrenceType: "permanent_attraction",
        artistName: null,
        tripRecommendationType: "attraction",
        durationText,
        sourceRating: rating.rating,
        sourceReviewCount: rating.reviewCount,
        highlights,
        capturedAt: Date.now(),
      };
    }

    const durationText = tripComLabelValue(lines, [
      /Duration\s*[:：]\s*(.*)$/i,
      /Продолжительность\s*[:：]\s*(.*)$/i,
      /Длительность\s*[:：]\s*(.*)$/i,
    ], 160);
    const meetingPoint = lines.find((line) =>
      line.length <= 500
      && /^(?:Meet at|Meeting point|Meet your guide at|Место встречи|Сбор у|Встречаемся)/i.test(line)
    ) || null;
    const city = tripComExcursionCity(lines, title, breadcrumbs);
    const cityAliases = [city, ...breadcrumbs]
      .map((value) => cleanText(value))
      .filter((value) => value && value.length <= 120)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 12);

    const itineraryDescription = tripComExcursionItinerary(lines);
    const resolvedDescription =
      itineraryDescription
      || genericDescription
      || (
        title && city
          ? [title, "Экскурсия Trip.com в " + city + "."].join(" ")
          : null
      );
    const packageTags = tripComExcursionPackageTags(lines);
    const price = tripComExcursionPrice(lines);

    const missing = [];
    if (!title) missing.push("название");
    if (!imageUrl) missing.push("фото");
    if (!resolvedDescription || resolvedDescription.length < 30) missing.push("описание");
    if (!city) missing.push("город отправления");
    if (missing.length > 0) {
      throw new Error("Trip.com: экскурсия — не найдено: " + missing.join(", ") + ".");
    }
    return {
      kind: "event",
      category: "activity",
      sourceProvider: "trip_com",
      sourceUrl: source.sourceUrl,
      externalId: source.externalId,
      title,
      imageUrl,
      description: resolvedDescription,
      country: null,
      city,
      cityAliases,
      venueName: null,
      address: meetingPoint,
      startDate: null,
      endDate: null,
      startTime: null,
      priceMin: price?.amount ?? null,
      priceMax: null,
      currency: price?.currency ?? null,
      tags: tripComTags(["экскурсия", ...packageTags]),
      activityType: "excursion",
      occurrenceType: "recurring_booking",
      artistName: null,
      tripRecommendationType: "excursion",
      durationText,
      sourceRating: rating.rating,
      sourceReviewCount: rating.reviewCount,
      highlights,
      capturedAt: Date.now(),
    };
  };


  
  const tripComHotelUrlCandidates = () => {
    const values = [
      location.href,
      document.querySelector('link[rel="canonical"]')?.href || "",
      meta('meta[property="og:url"]'),
    ];
    const result = [];
    for (const value of values) {
      if (!value) continue;
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== "https:") continue;
        if (result.some((item) => item.href === url.href)) continue;
        result.push(url);
      } catch {}
    }
    return result;
  };

  const tripComHotelSource = () => {
    for (const url of tripComHotelUrlCandidates()) {
      const sourceHost = url.hostname.toLowerCase();
      const host = sourceHost.replace(/^www\./, "");
      if (host !== "trip.com" && !host.endsWith(".trip.com")) continue;

      const path = url.pathname.replace(/\/+$/, "") || "/";
      const match = path.match(
        /^\/hotels\/([^/]+)-hotel-detail-(\d+)\/([^/]+)$/i,
      );
      if (!match) continue;

      const current = (() => {
        try {
          const value = new URL(location.href);
          const currentHost = value.hostname.toLowerCase().replace(/^www\./, "");
          const currentPath = value.pathname.replace(/\/+$/, "") || "/";
          return (
            (currentHost === "trip.com" || currentHost.endsWith(".trip.com"))
            && currentPath.includes("-hotel-detail-" + match[2] + "/")
          ) ? value.href : null;
        } catch {
          return null;
        }
      })();

      return {
        externalId: "hotel:" + match[2],
        hotelId: match[2],
        citySlug: match[1],
        hotelSlug: match[3],
        sourceUrl: current || url.href,
        sourceHost,
      };
    }

    return null;
  };

  const tripComHotelLines = () =>
    String(document.body?.innerText || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean)
      .slice(0, 900);

  const tripComHotelTypeValues = (entity) => {
    const raw = entity?.["@type"];
    return (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map((value) => cleanText(String(value || "")))
      .filter(Boolean);
  };

  const tripComHotelEntity = () =>
    jsonLdEntities().find((entity) =>
      tripComHotelTypeValues(entity).some((value) =>
        ["Hotel", "LodgingBusiness", "Resort", "Hostel", "BedAndBreakfast", "Apartment", "Motel"].includes(value),
      ),
    ) || null;

  const tripComHotelName = (value) => {
    if (typeof value === "string") return cleanText(value);
    if (!value || typeof value !== "object") return "";
    return cleanText(value.name || value.alternateName || "");
  };

  const tripComHotelNumber = (value, min, max) => {
    if (value == null || value === "") return null;
    const parsed = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };

  const tripComHotelTitle = (entity) => {
    const structured = tripComHotelName(entity?.name);
    if (structured) return structured;

    const h1 = cleanText(document.querySelector("h1")?.textContent || "");
    if (h1 && h1.length <= 300) return h1;

    return (
      meta('meta[property="og:title"]')
      || meta('meta[name="twitter:title"]')
      || cleanText(document.title)
    )
      .replace(/\s*[|–—-]\s*(?:Trip\.com|Tripcom).*$/i, "")
      .replace(/\s+-\s+\d{4}.*$/i, "")
      .trim();
  };

  const tripComHotelDescription = (entity, title) => {
    const structured = cleanText(entity?.description || "");
    if (structured && structured.length >= 40 && structured.length <= 4000) {
      return structured;
    }

    const metadata = [
      meta('meta[name="description"]'),
      meta('meta[property="og:description"]'),
    ]
      .map((value) => cleanText(value))
      .find((value) =>
        value.length >= 40
        && value.length <= 4000
        && value !== title
        && !/^(?:Trip\.com|Book hotels|Find cheap hotels|Бронирование дешевых отелей)/i.test(value)
      );
    if (metadata) return metadata.slice(0, 4000);

    const candidates = [
      ...document.querySelectorAll(
        'main [class*="description" i], main [class*="intro" i], main [class*="summary" i], main p',
      ),
    ]
      .map((node) => cleanText(node.textContent || ""))
      .filter((value) =>
        value.length >= 60
        && value.length <= 1800
        && value !== title
        && !/(?:cookie|privacy|sign in|log in|скачайте приложение|download app)/i.test(value)
      );
    return candidates[0] || null;
  };

  const tripComHotelLooksLikeCity = (value) => {
    const candidate = cleanText(value || "");
    if (!candidate || candidate.length < 2 || candidate.length > 120) return false;
    if (/d{2,}/.test(candidate)) return false;
    if (/(?:^|[s,])(?:ул.?|улица|street|st.?|road|rd.?|avenue|ave.?|r.|rua|проспект|пр-т|дом|house)(?:[s,]|$)/i.test(candidate)) return false;
    if ((candidate.match(/,/g) || []).length >= 2) return false;
    return true;
  };

  const tripComHotelStructuredLocation = (entity) => {
    const address = entity?.address;
    if (!address || typeof address !== "object") {
      return { city: null, region: null, country: null };
    }
    const city = tripComHotelName(address.addressLocality);
    const region = tripComHotelName(address.addressRegion);
    const country = tripComHotelName(address.addressCountry);
    return {
      city: tripComHotelLooksLikeCity(city) ? city : null,
      region: region || null,
      country: country || null,
    };
  };

  const tripComHotelCityFromPage = (lines) => {
    const top = lines.slice(0, 140);
    for (const line of top) {
      const patterns = [
        /^Все объекты размещения в г.s*(.+)$/i,
        /^Все объекты размещения вs+(.+)$/i,
        /^All properties ins+(.+)$/i,
        /^Hotels ins+(.+)$/i,
        /^Отели вs+(.+)$/i,
      ];
      for (const pattern of patterns) {
        const match = line.match(pattern);
        const value = cleanText(match?.[1] || "");
        if (tripComHotelLooksLikeCity(value)) return value;
      }
    }

    const descriptions = [
      meta('meta[name="description"]'),
      meta('meta[property="og:description"]'),
    ];
    for (const value of descriptions) {
      const parenthesized = cleanText(value).match(/(s*[1-5](?:[.,]d)?s*[★⭐]s*,s*([^)]+))/);
      const city = cleanText(parenthesized?.[1] || "");
      if (tripComHotelLooksLikeCity(city)) return city;
    }

    const values = [
      meta('meta[property="og:title"]'),
      cleanText(document.title),
    ];
    for (const value of values) {
      const ru = value.match(/sвs+г.s*([^|–—-]+?)(?:s*[-–—|]|$)/i);
      if (tripComHotelLooksLikeCity(ru?.[1])) return cleanText(ru[1]);
      const en = value.match(/sins+([^|–—-]+?)(?:s*[-–—|]|$)/i);
      if (tripComHotelLooksLikeCity(en?.[1]) && !/trip.com/i.test(en[1])) return cleanText(en[1]);
    }
    return null;
  };

  const tripComHotelRating = (entity, lines) => {
    const aggregate = entity?.aggregateRating && typeof entity.aggregateRating === "object"
      ? entity.aggregateRating
      : null;
    const structuredRating = tripComHotelNumber(aggregate?.ratingValue, 0, 10);
    const structuredCount = tripComHotelNumber(
      aggregate?.reviewCount ?? aggregate?.ratingCount,
      0,
      100000000,
    );
    if (structuredRating !== null || structuredCount !== null) {
      return { rating: structuredRating, reviewCount: structuredCount };
    }

    const top = lines.slice(0, 260);
    let rating = null;
    let reviewCount = null;
    for (const line of top) {
      if (rating === null) {
        const match = line.match(/(?:^|\s)(10(?:[.,]0)?|[0-9](?:[.,]\d)?)\s*\/\s*10(?:\s|$)/);
        if (match) rating = tripComHotelNumber(match[1], 0, 10);
      }
      if (reviewCount === null) {
        const reviews = line.match(/(?:Все\s+)?([\d\s,.]+)\s+(?:подтвержденн(?:ых|ый)\s+)?отзыв(?:а|ов)?|([\d\s,.]+)\s+(?:verified\s+)?reviews?/i);
        const raw = reviews?.[1] || reviews?.[2] || "";
        const parsed = Number(raw.replace(/[^\d]/g, ""));
        if (Number.isFinite(parsed) && parsed >= 0) reviewCount = parsed;
      }
      if (rating !== null && reviewCount !== null) break;
    }
    return { rating, reviewCount };
  };

  const tripComHotelStars = (entity, lines) => {
    const structured = entity?.starRating;
    const structuredValue =
      structured && typeof structured === "object"
        ? structured.ratingValue ?? structured.value
        : structured;
    const parsed = tripComHotelNumber(structuredValue, 1, 5);
    if (parsed !== null) return parsed;

    const metadata = [
      meta('meta[name="description"]'),
      meta('meta[property="og:description"]'),
      meta('meta[property="og:title"]'),
      cleanText(document.title),
    ];
    for (const raw of metadata) {
      const value = cleanText(raw);
      const symbolMatch = value.match(/(?:^|[ (])([1-5](?:[.,][0-9])?)[ ]*[★⭐](?:[ ,)]|$)/);
      const symbolValue = tripComHotelNumber(symbolMatch?.[1], 1, 5);
      if (symbolValue !== null) return symbolValue;

      const wordMatch = value.match(/(?:^|[ (])([1-5](?:[.,][0-9])?)[ ]*(?:звезд[^ ,)]*|star(?:s)?)(?:[ ,)]|$)/i);
      const wordValue = tripComHotelNumber(wordMatch?.[1], 1, 5);
      if (wordValue !== null) return wordValue;
    }

    for (const node of document.querySelectorAll('[aria-label*="звезд" i], [aria-label*="star" i], [title*="звезд" i], [title*="star" i]')) {
      const label = cleanText(node.getAttribute("aria-label") || node.getAttribute("title") || "");
      const match = label.match(/([1-5](?:[.,]d)?)s*(?:звезд|star)/i);
      const value = tripComHotelNumber(match?.[1], 1, 5);
      if (value !== null) return value;
    }

    for (const line of lines.slice(0, 180)) {
      const symbolMatch = line.match(/(?:^|[ ])([1-5](?:[.,][0-9])?)[ ]*[★⭐](?:[ ]|$)/);
      const symbolValue = tripComHotelNumber(symbolMatch?.[1], 1, 5);
      if (symbolValue !== null) return symbolValue;

      const wordMatch = line.match(/([1-5](?:[.,][0-9])?)[ -]*(?:звезд[^ ,)]*|star(?:s)?)/i);
      const wordValue = tripComHotelNumber(wordMatch?.[1], 1, 5);
      if (wordValue !== null) return wordValue;
    }
    return null;
  };

  const tripComHotelMoney = (raw, fallbackCurrency = null) => {
    const value = cleanText(raw || "");
    if (!value) return null;

    const codePattern = "(USD|EUR|GBP|RUB|CNY|JPY|KRW|HKD|AUD|CAD|SGD|AED|TRY|KZT|THB|IDR|MYR|VND|PHP|INR)";
    const amountPattern = "(\\d[\\d\\s,.]*\\d|\\d)";
    const matches = [];

    const push = (amountRaw, currencyRaw, index) => {
      const token = String(currencyRaw || "").toUpperCase();
      const currency =
        token === "₽" ? "RUB"
        : token === "₸" ? "KZT"
        : token === "€" ? "EUR"
        : token === "£" ? "GBP"
        : token === "¥" ? "CNY"
        : token === "$" ? "USD"
        : token || fallbackCurrency;
      if (!currency) return;

      let amountText = String(amountRaw || "").split(" ").join("");
      if (/^[0-9]{1,3}(?:,[0-9]{3})+(?:[.][0-9]+)?$/.test(amountText)) {
        amountText = amountText.replace(/,/g, "");
      } else if (/^[0-9]{1,3}(?:[.][0-9]{3})+(?:,[0-9]+)?$/.test(amountText)) {
        amountText = amountText.replace(/[.]/g, "").replace(",", ".");
      } else if (amountText.includes(",") && !amountText.includes(".")) {
        amountText = amountText.replace(",", ".");
      } else {
        amountText = amountText.replace(/,/g, "");
      }

      const amount = Number(amountText);
      if (Number.isFinite(amount) && amount > 0 && amount < 1000000000) {
        matches.push({ amount, currency, index });
      }
    };

    const patterns = [
      new RegExp(amountPattern + "\\s*(₽|₸|€|£|\\$|¥)", "gi"),
      new RegExp("(₽|₸|€|£|\\$|¥)\\s*" + amountPattern, "gi"),
      new RegExp(amountPattern + "\\s*\\b" + codePattern + "\\b", "gi"),
      new RegExp("\\b" + codePattern + "\\b\\s*" + amountPattern, "gi"),
    ];

    for (const pattern of patterns) {
      for (const match of value.matchAll(pattern)) {
        const symbolFirst = /^[₽₸€£$¥]/.test(match[0]);
        const codeFirst = new RegExp("^" + codePattern, "i").test(match[0]);
        if (symbolFirst || codeFirst) {
          push(match[2], match[1], match.index ?? 0);
        } else {
          push(match[1], match[2], match.index ?? 0);
        }
      }
    }

    matches.sort((a, b) => a.index - b.index);
    return matches[0] || null;
  };

  const tripComHotelPrice = (entity, lines) => {
    const offersRaw = entity?.offers;
    const offers = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
    for (const offer of offers) {
      if (!offer || typeof offer !== "object") continue;
      const currency = cleanText(offer.priceCurrency || offer.currency || "").toUpperCase() || null;
      const value = offer.lowPrice ?? offer.price ?? offer.highPrice;
      const amount = tripComHotelNumber(value, 0.01, 1000000000);
      if (amount !== null && currency) return { amount, currency, source: "structured" };
    }

    const top = lines.slice(0, 280);
    const preferredStart = top.findIndex((line) =>
      /^(?:Лучшая.*цена.*|Best.*price.*|Цена от.*|From)$/i.test(line)
    );
    if (preferredStart >= 0) {
      for (const line of top.slice(preferredStart, preferredStart + 12)) {
        const parsed = tripComHotelMoney(line);
        if (parsed) return { ...parsed, source: "visible_best_price" };
      }
    }

    for (const line of top) {
      const parsed = tripComHotelMoney(line);
      if (!parsed) continue;
      if (/(?:итого|total|налог|tax|сбор|fee)/i.test(line)) continue;
      if (/(?:заs+ночь|заs+номер|1s+ночь|pers+night|nightly|room|ценаs+от|отs+d|froms+d)/i.test(line)) {
        return { ...parsed, source: "visible" };
      }
    }
    return null;
  };

  const tripComHotelDates = (sourceUrl) => {
    try {
      const url = new URL(sourceUrl);
      const checkin = url.searchParams.get("checkin") || url.searchParams.get("checkIn");
      const checkout = url.searchParams.get("checkout") || url.searchParams.get("checkOut");
      const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : null;
      return { checkinDate: valid(checkin), checkoutDate: valid(checkout) };
    } catch {
      return { checkinDate: null, checkoutDate: null };
    }
  };

  const tripComHotelAmenities = (lines) => {
    const start = lines.findIndex((line) =>
      /^(?:Услуги и удобства|Удобства|Amenities|Facilities|Services & Amenities)$/i.test(line),
    );
    if (start < 0) return [];

    const stop = /^(?:Все удобства|All amenities|Лучшая цена|Best price|Цена от|From|Правила|Policies|Номера|Rooms|Отзывы гостей|Отзывы|Reviews?|Окрестности|Surroundings|Описание|About)$/i;
    const noise = /^(?:Показать все|Смотреть все|Подробнее|Развернуть|Свернуть|Show all|View all|More)$/i;
    const values = [];
    for (const raw of lines.slice(start + 1, start + 45)) {
      let line = cleanText(raw);
      if (!line) continue;
      if (stop.test(line)) break;
      if (noise.test(line)) continue;
      if (tripComHotelMoney(line)) break;
      if (line.length < 2 || line.length > 100) continue;
      if (/^d+(?:[.,]d+)?$/.test(line)) continue;
      line = line
        .replace(/(Бесплатно|Free)$/i, " · $1")
        .replace(/s+·s+/g, " · ");
      if (!values.includes(line)) values.push(line);
      if (values.length >= 12) break;
    }
    return values;
  };

  const tripComHotelGeo = (entity) => {
    const geo = entity?.geo && typeof entity.geo === "object" ? entity.geo : null;
    const latitude = tripComHotelNumber(geo?.latitude, -90, 90);
    const longitude = tripComHotelNumber(geo?.longitude, -180, 180);
    return { latitude, longitude };
  };

  const tripComHotelCapture = () => {
    const source = tripComHotelSource();
    if (!source) return null;

    const lines = tripComHotelLines();
    const entity = tripComHotelEntity();
    const title = tripComHotelTitle(entity);
    const description = tripComHotelDescription(entity, title);
    const location = tripComHotelStructuredLocation(entity);
    const city = tripComHotelCityFromPage(lines) || location.city;
    const rating = tripComHotelRating(entity, lines);
    const stars = tripComHotelStars(entity, lines);
    const price = tripComHotelPrice(entity, lines);
    const dates = tripComHotelDates(source.sourceUrl);
    const geo = tripComHotelGeo(entity);
    const amenities = tripComHotelAmenities(lines);

    const missingFields = [];
    if (!title) missingFields.push("title");
    if (!description) missingFields.push("description");
    if (!city) missingFields.push("city");
    if (rating.rating === null) missingFields.push("rating");
    if (rating.reviewCount === null) missingFields.push("reviewCount");
    if (stars === null) missingFields.push("stars");
    if (!price) missingFields.push("price");

    return {
      kind: "hotel",
      sourceProvider: "trip_com",
      sourceUrl: source.sourceUrl,
      externalId: source.externalId,
      hotelId: source.hotelId,
      sourceHost: source.sourceHost,
      title: title || null,
      description,
      city: city || null,
      region: location.region,
      country: location.country,
      rating: rating.rating,
      ratingScale: 10,
      reviewCount: rating.reviewCount,
      stars,
      price: price?.amount ?? null,
      currency: price?.currency ?? null,
      priceSource: price?.source ?? null,
      checkinDate: dates.checkinDate,
      checkoutDate: dates.checkoutDate,
      latitude: geo.latitude,
      longitude: geo.longitude,
      amenities,
      missingFields,
      capturedAt: Date.now(),
    };
  };


  
  const yandexTravelHotelUrlCandidates = () => {
    const values = [
      location.href,
      document.querySelector('link[rel="canonical"]')?.href || "",
      meta('meta[property="og:url"]'),
    ];
    const result = [];
    for (const value of values) {
      if (!value) continue;
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== "https:") continue;
        if (result.some((item) => item.href === url.href)) continue;
        result.push(url);
      } catch {}
    }
    return result;
  };

  const yandexTravelHotelSource = () => {
    for (const url of yandexTravelHotelUrlCandidates()) {
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "travel.yandex.ru") continue;

      const path = url.pathname.replace(/\/+$/, "") || "/";
      const match = path.match(/^\/hotels\/([^/]+)\/([^/]+)$/i);
      if (!match) continue;

      const citySlug = match[1].toLowerCase();
      const hotelSlug = match[2].toLowerCase();
      if (/^(?:map|search|offers?)$/i.test(hotelSlug) || /^filter-/i.test(hotelSlug)) continue;

      const current = (() => {
        try {
          const value = new URL(location.href);
          const currentHost = value.hostname.toLowerCase().replace(/^www\./, "");
          const currentPath = value.pathname.replace(/\/+$/, "") || "/";
          return currentHost === "travel.yandex.ru" && currentPath.toLowerCase() === path.toLowerCase()
            ? value.href
            : null;
        } catch {
          return null;
        }
      })();

      const hotelId = citySlug + "/" + hotelSlug;
      return {
        externalId: "hotel:" + hotelId,
        hotelId,
        citySlug,
        hotelSlug,
        sourceUrl: current || url.href,
        sourceHost: url.hostname.toLowerCase(),
      };
    }
    return null;
  };

  const yandexTravelHotelLines = () =>
    String(document.body?.innerText || "")
      .split(/\n+/)
      .map((value) => cleanText(value))
      .filter(Boolean)
      .slice(0, 1000);

  const yandexTravelHotelTypeValues = (entity) => {
    const raw = entity?.["@type"];
    return (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map((value) => cleanText(String(value || "")))
      .filter(Boolean);
  };

  const yandexTravelHotelEntity = () =>
    jsonLdEntities().find((entity) =>
      yandexTravelHotelTypeValues(entity).some((value) =>
        ["Hotel", "LodgingBusiness", "Resort", "Hostel", "BedAndBreakfast", "Apartment", "Motel"].includes(value),
      ),
    ) || null;

  const yandexTravelHotelName = (value) => {
    if (typeof value === "string") return cleanText(value);
    if (!value || typeof value !== "object") return "";
    return cleanText(value.name || value.alternateName || "");
  };

  const yandexTravelHotelNumber = (value, min, max) => {
    if (value == null || value === "") return null;
    const parsed = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };

  const yandexTravelHotelTitle = (entity) => {
    const structured = yandexTravelHotelName(entity?.name);
    if (structured) return structured;

    const h1 = cleanText(document.querySelector("h1")?.textContent || "");
    if (h1) {
      return h1
        .replace(/\s+[1-5](?:[.,]\d)?\s*(?:★|\*)\s*$/i, "")
        .trim();
    }

    return (
      meta('meta[property="og:title"]')
      || meta('meta[name="twitter:title"]')
      || cleanText(document.title)
    )
      .replace(/\s+[—-]\s+Яндекс Путешествия.*$/i, "")
      .replace(/\s+от\s+[\d\s,.]+(?:₽|₸|€|£|\$|¥).*$/i, "")
      .trim();
  };

  const yandexTravelHotelDescription = (entity, lines, title) => {
    const sectionStart = lines.findIndex((line) => /^(?:Об этом месте|Об\s+этом месте|About)$/i.test(line));
    if (sectionStart >= 0) {
      const stop = /^(?:Удобства(?: и услуги)?|Amenities|Важная информация|Полезная информация|Отзывы|Где находится|Правила|Номера|Rooms)$/i;
      const parts = [];
      for (const raw of lines.slice(sectionStart + 1, sectionStart + 16)) {
        const line = cleanText(raw);
        if (!line) continue;
        if (stop.test(line)) break;
        if (line === title) continue;
        if (line.length < 35 || line.length > 1200) continue;
        if (/^(?:Цена номера|Расстояние до центра|Количество номеров|Время заезда|Время выезда)/i.test(line)) continue;
        parts.push(line);
        if (parts.join(" ").length >= 1200 || parts.length >= 3) break;
      }
      if (parts.length) return parts.join(" ").slice(0, 2200);
    }

    const structured = cleanText(entity?.description || "");
    if (structured && structured.length >= 40 && structured.length <= 3000) return structured;

    return [
      meta('meta[name="description"]'),
      meta('meta[property="og:description"]'),
    ]
      .map((value) => cleanText(value))
      .find((value) => value.length >= 40 && value.length <= 3000 && value !== title)
      ?.slice(0, 2200) || null;
  };

  const yandexTravelHotelStructuredLocation = (entity) => {
    const candidates = [
      entity?.address,
      entity?.location?.address,
      entity?.contentLocation?.address,
    ];
    for (const address of candidates) {
      if (!address || typeof address !== "object") continue;
      const city = yandexTravelHotelName(address.addressLocality);
      const region = yandexTravelHotelName(address.addressRegion);
      const country = yandexTravelHotelName(address.addressCountry);
      if (city || region || country) {
        return {
          city: city || null,
          region: region || null,
          country: country || null,
        };
      }
    }
    return { city: null, region: null, country: null };
  };

  const yandexTravelHotelCity = (entity, lines, description) => {
    const structured = yandexTravelHotelStructuredLocation(entity);
    if (structured.city) return { ...structured, city: structured.city };

    const prose = [description || "", ...lines.slice(0, 180)].join(" ");
    const match = prose.match(/(?:расположен[ао]?|находится)\s+в\s+городе\s+([A-Za-zА-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһ'’ -]{2,80}?)(?=\s+(?:в|на|недалеко|рядом|и)\b|[,.]|$)/i);
    const city = cleanText(match?.[1] || "");
    return { ...structured, city: city || null };
  };

  const yandexTravelHotelRating = (entity, lines) => {
    const aggregate = entity?.aggregateRating && typeof entity.aggregateRating === "object"
      ? entity.aggregateRating
      : null;
    const structuredRating = yandexTravelHotelNumber(aggregate?.ratingValue, 0, 5);
    const structuredCount = yandexTravelHotelNumber(
      aggregate?.reviewCount ?? aggregate?.ratingCount,
      0,
      100000000,
    );
    if (structuredRating !== null || structuredCount !== null) {
      return { rating: structuredRating, reviewCount: structuredCount };
    }

    const top = lines.slice(0, 150);
    let rating = null;
    let reviewCount = null;
    for (let index = 0; index < top.length; index += 1) {
      const line = top[index];
      if (rating === null) {
        const exact = line.match(/^(5(?:[.,]0)?|[0-4](?:[.,]\d))$/);
        if (exact) rating = yandexTravelHotelNumber(exact[1], 0, 5);
      }
      if (reviewCount === null) {
        const reviews = line.match(/([\d\s,.]+)\s+отзыв(?:а|ов)?/i);
        if (reviews?.[1]) {
          const parsed = Number(reviews[1].replace(/[^\d]/g, ""));
          if (Number.isFinite(parsed) && parsed >= 0) reviewCount = parsed;
        }
      }
      if (rating !== null && reviewCount !== null) break;
    }
    return { rating, reviewCount };
  };

  const yandexTravelHotelStars = (entity, lines) => {
    const structured = entity?.starRating;
    const raw = structured && typeof structured === "object"
      ? structured.ratingValue ?? structured.value
      : structured;
    const parsed = yandexTravelHotelNumber(raw, 1, 5);
    if (parsed !== null) return parsed;

    const candidates = [
      cleanText(document.querySelector("h1")?.textContent || ""),
      meta('meta[property="og:title"]'),
      cleanText(document.title),
    ];
    for (const value of candidates) {
      const match = value.match(/(?:^|\s)([1-5](?:[.,]\d)?)\s*(?:★|\*)(?:\s|$)/);
      const star = yandexTravelHotelNumber(match?.[1], 1, 5);
      if (star !== null) return star;
    }

    for (const line of lines.slice(0, 420)) {
      const match = line.match(/^Количество звезд:\s*([1-5](?:[.,]\d)?)$/i)
        || line.match(/^Количество звёзд:\s*([1-5](?:[.,]\d)?)$/i);
      const star = yandexTravelHotelNumber(match?.[1], 1, 5);
      if (star !== null) return star;
    }
    return null;
  };

  const yandexTravelHotelMoney = (raw, fallbackCurrency = null) => {
    const value = cleanText(raw || "");
    if (!value) return null;

    const codePattern = "(USD|EUR|GBP|RUB|CNY|JPY|KRW|HKD|AUD|CAD|SGD|AED|TRY|KZT|THB|IDR|MYR|VND|PHP|INR)";
    const amountPattern = "(\\d[\\d\\s,.]*\\d|\\d)";
    const matches = [];

    const push = (amountRaw, currencyRaw, index) => {
      const token = String(currencyRaw || "").toUpperCase();
      const currency =
        token === "₽" ? "RUB"
        : token === "₸" ? "KZT"
        : token === "€" ? "EUR"
        : token === "£" ? "GBP"
        : token === "¥" ? "CNY"
        : token === "$" ? "USD"
        : token || fallbackCurrency;
      if (!currency) return;

      let amountText = String(amountRaw || "").split(" ").join("");
      if (/^[0-9]{1,3}(?:,[0-9]{3})+(?:[.][0-9]+)?$/.test(amountText)) {
        amountText = amountText.replace(/,/g, "");
      } else if (/^[0-9]{1,3}(?:[.][0-9]{3})+(?:,[0-9]+)?$/.test(amountText)) {
        amountText = amountText.replace(/[.]/g, "").replace(",", ".");
      } else if (amountText.includes(",") && !amountText.includes(".")) {
        amountText = amountText.replace(",", ".");
      } else {
        amountText = amountText.replace(/,/g, "");
      }

      const amount = Number(amountText);
      if (Number.isFinite(amount) && amount > 0 && amount < 1000000000) {
        matches.push({ amount, currency, index });
      }
    };

    const patterns = [
      new RegExp(amountPattern + "\\s*(₽|₸|€|£|\\$|¥)", "gi"),
      new RegExp("(₽|₸|€|£|\\$|¥)\\s*" + amountPattern, "gi"),
      new RegExp(amountPattern + "\\s*\\b" + codePattern + "\\b", "gi"),
      new RegExp("\\b" + codePattern + "\\b\\s*" + amountPattern, "gi"),
    ];

    for (const pattern of patterns) {
      for (const match of value.matchAll(pattern)) {
        const symbolFirst = /^[₽₸€£$¥]/.test(match[0]);
        const codeFirst = new RegExp("^" + codePattern, "i").test(match[0]);
        if (symbolFirst || codeFirst) push(match[2], match[1], match.index ?? 0);
        else push(match[1], match[2], match.index ?? 0);
      }
    }

    matches.sort((a, b) => a.index - b.index);
    return matches[0] || null;
  };

  const yandexTravelHotelPrice = (entity, lines) => {
    const offersRaw = entity?.offers;
    const offers = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
    for (const offer of offers) {
      if (!offer || typeof offer !== "object") continue;
      const currency = cleanText(offer.priceCurrency || offer.currency || "").toUpperCase() || null;
      const value = offer.lowPrice ?? offer.price ?? offer.highPrice;
      const amount = yandexTravelHotelNumber(value, 0.01, 1000000000);
      if (amount !== null && currency) return { amount, currency, source: "structured" };
    }

    for (const raw of [
      meta('meta[property="og:title"]'),
      meta('meta[name="twitter:title"]'),
      cleanText(document.title),
    ]) {
      if (!/(?:от|from)\s+/i.test(raw)) continue;
      const parsed = yandexTravelHotelMoney(raw);
      if (parsed) return { ...parsed, source: "meta_starting_price" };
    }

    for (const line of lines) {
      if (!/^Цена номера (?:за ночь|\(ночь\)):/i.test(line)) continue;
      const parsed = yandexTravelHotelMoney(line);
      if (parsed) return { ...parsed, source: "nightly_info" };
    }

    const datesIndex = lines.findIndex((line) => /^Цены на ближайшие даты:?$/i.test(line));
    if (datesIndex >= 0) {
      for (const line of lines.slice(datesIndex + 1, datesIndex + 16)) {
        const parsed = yandexTravelHotelMoney(line);
        if (parsed) return { ...parsed, source: "nearby_dates" };
      }
    }

    for (const line of lines.slice(0, 260)) {
      if (!/(?:^|\s)от\s+[\d]/i.test(line)) continue;
      const parsed = yandexTravelHotelMoney(line);
      if (parsed) return { ...parsed, source: "visible_starting_price" };
    }
    return null;
  };

  const yandexTravelHotelDates = (sourceUrl) => {
    try {
      const url = new URL(sourceUrl);
      const first = (keys) => {
        for (const key of keys) {
          const value = url.searchParams.get(key);
          if (value) return value;
        }
        return null;
      };
      const checkin = first(["checkinDate", "checkInDate", "checkin", "checkIn", "dateFrom"]);
      const checkout = first(["checkoutDate", "checkOutDate", "checkout", "checkOut", "dateTo"]);
      const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : null;
      return { checkinDate: valid(checkin), checkoutDate: valid(checkout) };
    } catch {
      return { checkinDate: null, checkoutDate: null };
    }
  };

  const yandexTravelHotelAmenities = (lines) => {
    const start = lines.findIndex((line) =>
      /^(?:Удобства|Удобства и услуги|Amenities)$/i.test(line),
    );
    if (start < 0) return [];

    const stop = /^(?:Отзывы|Полезная информация|Важная информация|Где находится|Об этом месте|Правила|Номера|Rooms|Безопасность)$/i;
    const noise = /^(?:Показать все|Смотреть все|Подробнее|Развернуть|Свернуть|Show all|View all|More)$/i;
    const values = [];
    for (const raw of lines.slice(start + 1, start + 50)) {
      const line = cleanText(raw);
      if (!line) continue;
      if (stop.test(line)) break;
      if (noise.test(line)) continue;
      if (line.length < 2 || line.length > 100) continue;
      if (/^(?:Тип объекта|Дата постройки|Дата реконструкции|Количество номеров|Время заезда|Время выезда)$/i.test(line)) break;
      if (!values.includes(line)) values.push(line);
      if (values.length >= 12) break;
    }
    return values;
  };

  const yandexTravelHotelGeo = (entity) => {
    const geo = entity?.geo && typeof entity.geo === "object" ? entity.geo : null;
    return {
      latitude: yandexTravelHotelNumber(geo?.latitude, -90, 90),
      longitude: yandexTravelHotelNumber(geo?.longitude, -180, 180),
    };
  };

  const yandexTravelHotelCapture = () => {
    const source = yandexTravelHotelSource();
    if (!source) return null;

    const lines = yandexTravelHotelLines();
    const entity = yandexTravelHotelEntity();
    const title = yandexTravelHotelTitle(entity);
    if (!title || /^(?:Отели и гостиницы|Отели|Жильё)\s+в\s+/i.test(title)) return null;

    const description = yandexTravelHotelDescription(entity, lines, title);
    const location = yandexTravelHotelCity(entity, lines, description);
    const rating = yandexTravelHotelRating(entity, lines);
    const stars = yandexTravelHotelStars(entity, lines);
    const price = yandexTravelHotelPrice(entity, lines);
    const dates = yandexTravelHotelDates(source.sourceUrl);
    const geo = yandexTravelHotelGeo(entity);
    const amenities = yandexTravelHotelAmenities(lines);

    const missingFields = [];
    if (!title) missingFields.push("title");
    if (!description) missingFields.push("description");
    if (!location.city) missingFields.push("city");
    if (rating.rating === null) missingFields.push("rating");
    if (rating.reviewCount === null) missingFields.push("reviewCount");
    if (stars === null) missingFields.push("stars");
    if (!price) missingFields.push("price");

    return {
      kind: "hotel",
      sourceProvider: "yandex_travel",
      sourceUrl: source.sourceUrl,
      externalId: source.externalId,
      hotelId: source.hotelId,
      sourceHost: source.sourceHost,
      title: title || null,
      description,
      city: location.city,
      region: location.region,
      country: location.country,
      rating: rating.rating,
      ratingScale: 5,
      reviewCount: rating.reviewCount,
      stars,
      price: price?.amount ?? null,
      currency: price?.currency ?? null,
      priceSource: price?.source ?? null,
      checkinDate: dates.checkinDate,
      checkoutDate: dates.checkoutDate,
      latitude: geo.latitude,
      longitude: geo.longitude,
      amenities,
      missingFields,
      capturedAt: Date.now(),
    };
  };


  const cleanLitresDescription = (value) => {
    let result = cleanText(value || "");
    if (!result) return "";

    result = result.replace(
      /^Книга\s+.{0,300}?[«"].{1,300}?[»"]\s*[—-]\s+(?=(?:НЕЗАКОННОЕ ПОТРЕБЛЕНИЕ|Есть упоминание))/i,
      "",
    );
    result = result.replace(
      /^Есть упоминание\s+[^.!?]{1,180}[.!?]?\s*/i,
      "",
    );
    result = result.replace(
      /^НЕЗАКОННОЕ ПОТРЕБЛЕНИЕ НАРКОТИЧЕСКИХ СРЕДСТВ[\s\S]{0,700}?ОТВЕТСТВЕННОСТЬ\s*/i,
      "",
    );
    result = result
      .replace(/\s+©\s*[\s\S]*$/i, "")
      .replace(
        /\s+(?:Возрастное ограничение:|Дата выхода на Литрес:|Дата написания:|Длительность:|ISBN:)\s*[\s\S]*$/i,
        "",
      )
      .trim();
    return result;
  };

  const litresSource = () => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "litres.ru") return null;
    const match = location.pathname.match(
      /^\/(book|audiobook)\/[^/]+\/[^/]+-(\d+)\/?$/i,
    );
    if (!match) return null;
    const pathname = location.pathname.endsWith("/")
      ? location.pathname
      : location.pathname + "/";
    return {
      sourceKind: match[1].toLowerCase(),
      externalId: match[2],
      sourceUrl: "https://www.litres.ru" + pathname,
    };
  };

  const litresBookCapture = () => {
    const source = litresSource();
    if (!source) return null;

    const entity = ldBookEntity();
    const bodyText = cleanText(document.body?.innerText || "");
    const title =
      cleanText(entity?.name || "") ||
      text("h1") ||
      meta('meta[property="og:title"]')
        .replace(/\s+[–—-]\s+.*Литрес.*$/i, "")
        .trim() ||
      cleanText(document.title).replace(/\s+[–—-]\s+.*Литрес.*$/i, "").trim();
    if (!title) return null;

    const structuredAuthors = ldPeopleNames(entity?.author);
    const linkedAuthors = structuredAuthors.length === 0
      ? uniqueTexts(
          document.querySelectorAll('main a[href*="/author/"], a[href^="/author/"]'),
          1,
        )
      : [];
    const authors = (structuredAuthors.length ? structuredAuthors : linkedAuthors)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 8);
    if (authors.length === 0) return null;

    const descriptionFromAbout = cleanLitresDescription(
      bodyText.match(
        /(?:^|\s)О книге\s+(.{40,4000}?)(?=\s+(?:©|Смотреть оглавление|Другие версии книги|Жанры и теги|Отзывы|Цитаты|Описание книги|Возрастное ограничение:|Дата выхода на Литрес:)|$)/i,
      )?.[1] || "",
    );
    const descriptionFromDetails = cleanLitresDescription(
      bodyText.match(
        /Описание книги\s+(.{40,4000}?)(?=\s+(?:Возрастное ограничение:|Дата выхода на Литрес:|Дата написания:|Длительность:|ISBN:)|$)/i,
      )?.[1] || "",
    );
    const description =
      descriptionFromAbout ||
      cleanLitresDescription(entity?.description || "") ||
      cleanLitresDescription(meta('meta[name="description"]')) ||
      cleanLitresDescription(meta('meta[property="og:description"]')) ||
      descriptionFromDetails ||
      null;

    const imageUrl =
      ldImageUrl(entity) ||
      (() => {
        const value =
          meta('meta[property="og:image:secure_url"]') ||
          meta('meta[property="og:image"]') ||
          meta('meta[name="twitter:image"]');
        if (!value) return null;
        try {
          const url = new URL(value, location.href);
          return url.protocol === "https:" ? url.href : null;
        } catch {
          return null;
        }
      })();

    const writtenYear =
      bodyText.match(/Дата (?:написания|перевода):\s*(18\d{2}|19\d{2}|20\d{2}|21\d{2})/i)?.[1] ||
      bodyText.match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\s+год\b/i)?.[1] ||
      null;
    const year = ldYear(entity) || (writtenYear ? Number(writtenYear) : null);

    const ratingText =
      bodyText.match(/\b([0-5](?:[.,]\d))\s+[\d\s]+\s+оцен/i)?.[1] ||
      null;
    const ratingValue = ratingText ? Number(ratingText.replace(",", ".")) : null;
    const rating =
      ldRating(entity) ??
      (Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 5
        ? ratingValue
        : null);

    const structuredGenres = ldGenres(entity);
    const linkedGenres = uniqueTexts(
      document.querySelectorAll('main a[href*="/genre/"], main a[href*="/tag/"]'),
      24,
    );
    const genres = [...structuredGenres, ...linkedGenres]
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 16);

    const pagesRaw =
      bodyText.match(/Объем\s*:?\s*([\d\s]+)\s*(?:стр\.|страниц|страница|страницы)/i)?.[1] ||
      null;
    const pagesValue = pagesRaw ? Number(pagesRaw.replace(/\D/g, "")) : null;
    const pages =
      Number.isInteger(pagesValue) && pagesValue > 0 && pagesValue < 100000
        ? pagesValue
        : null;

    const isbn =
      cleanText(bodyText.match(/ISBN\s*:?\s*([0-9Xx-]{10,32})/i)?.[1] || "") ||
      null;

    const pairedFormats =
      /Текст\s*Аудио/i.test(bodyText) ||
      /Текст,\s*доступен аудиоформат/i.test(bodyText);
    const textAvailable = source.sourceKind === "book" || pairedFormats;
    const audioAvailable = source.sourceKind === "audiobook" || pairedFormats;

    const durationMatch = bodyText.match(
      /Длительность(?: книги)?\s+(?:(\d+)\s*ч\.?)?\s*(?:(\d+)\s*мин\.?)?/i,
    );
    const durationHours = durationMatch?.[1] ? Number(durationMatch[1]) : 0;
    const durationMinutes = durationMatch?.[2] ? Number(durationMatch[2]) : 0;
    const audioDurationMinutes =
      durationHours > 0 || durationMinutes > 0
        ? durationHours * 60 + durationMinutes
        : null;

    const seriesMatch =
      bodyText.match(/\d+\s+книга\s+из\s+\d+\s+в\s+серии\s+«([^»]{1,200})»/i) ||
      bodyText.match(/Входит в серию\s+«([^»]{1,200})»/i);
    const seriesIndexMatch = bodyText.match(
      /(\d+)\s+книга\s+из\s+\d+\s+в\s+серии/i,
    );
    const seriesIndex = seriesIndexMatch ? Number(seriesIndexMatch[1]) : null;

    return {
      kind: "book",
      sourceProvider: "litres",
      sourceUrl: source.sourceUrl,
      externalId: source.externalId,
      title,
      authors,
      imageUrl,
      description,
      year,
      rating,
      genres,
      pages,
      isbn,
      textAvailable,
      audioAvailable,
      audioDurationMinutes,
      seriesName: cleanText(seriesMatch?.[1] || "") || null,
      seriesIndex:
        Number.isInteger(seriesIndex) && seriesIndex > 0 ? seriesIndex : null,
      capturedAt: Date.now(),
    };
  };

  const kinopoiskCountry = (entity) => {
    const structured = ldCountry(entity);
    if (structured) return structured;

    const bodyText = cleanText(document.body?.innerText || "");
    const match = bodyText.match(/(?:^|\s)Страна\s+(.{2,120}?)\s+Жанр(?:\s|$)/i);
    const value = cleanText(match?.[1] || "");
    return value && value.length <= 120 ? value : null;
  };

  const kinopoiskScreenCapture = () => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "kinopoisk.ru") return null;
    const match = location.pathname.match(/^\/(film|series)\/(\d+)(?:\/|$)/i);
    if (!match) return null;

    const entity = ldScreenEntity();
    const fallbackCategory = match[1].toLowerCase() === "series" ? "series" : "movie";
    const category = screenCategoryFromEntity(entity, fallbackCategory);
    const id = match[2];
    const rawTitle =
      cleanText(entity?.name || "") ||
      text("h1") ||
      meta('meta[property="og:title"]') ||
      cleanText(document.title);
    const title = rawTitle
      .replace(/\s+(?:фильм|сериал),\s*\d{4}.*$/i, "")
      .replace(/\s*\(\d{4}\)\s*$/i, "")
      .replace(/\s*[—-]\s*Кинопоиск.*$/i, "")
      .trim();
    if (!title) return null;

    const description =
      cleanText(entity?.description || "") ||
      meta('meta[name="description"]') ||
      meta('meta[property="og:description"]') ||
      null;
    const imageUrl =
      ldImageUrl(entity) ||
      (() => {
        const value = meta('meta[property="og:image"]');
        if (!value) return null;
        try {
          const url = new URL(value, location.href);
          return url.protocol === "https:" ? url.href : null;
        } catch {
          return null;
        }
      })();

    const titleYear =
      rawTitle.match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/)?.[1] || null;
    const ratingText =
      cleanText(document.body?.innerText || "").match(/Рейтинг Кинопоиска\s*([0-9](?:[.,][0-9])?)/i)?.[1] ||
      null;
    const ratingValue = ratingText ? Number(ratingText.replace(",", ".")) : null;

    return {
      kind: "screen",
      category,
      sourceProvider: "kinopoisk",
      sourceUrl: "https://www.kinopoisk.ru/" + match[1].toLowerCase() + "/" + id + "/",
      externalId: id,
      title,
      originalTitle: cleanText(entity?.alternateName || "") || null,
      imageUrl,
      description,
      country: kinopoiskCountry(entity),
      year: ldYear(entity) || (titleYear ? Number(titleYear) : null),
      rating:
        ldRating(entity) ??
        (Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 10
          ? ratingValue
          : null),
      genres: ldGenres(entity),
      capturedAt: Date.now(),
    };
  };

  const screenCapture = () => kinopoiskScreenCapture();

  const findProductJsonLd = () => {
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(node.textContent || "null");
        const roots = Array.isArray(parsed) ? parsed : [parsed];
        const candidates = [];
        for (const root of roots) {
          if (!root || typeof root !== "object") continue;
          candidates.push(root);
          if (Array.isArray(root["@graph"])) candidates.push(...root["@graph"]);
        }
        const product = candidates.find((item) => {
          const type = item?.["@type"];
          return type === "Product" || (Array.isArray(type) && type.includes("Product"));
        });
        if (product) return product;
      } catch {}
    }
    return null;
  };

  const merchantName = () => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "ozon.ru") return "Ozon";
    if (host === "wildberries.ru" || host.endsWith(".wildberries.ru")) return "Wildberries";
    if (host === "market.yandex.ru") return "Яндекс Маркет";
    if (host === "lamoda.ru") return "Lamoda";
    return host;
  };

  const lamodaProductSku = () => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "lamoda.ru") return null;
    return location.pathname.match(/^\/p\/([a-z0-9]+)\/[^/]+\/?$/i)?.[1] || null;
  };

  const lamodaProductMatchesPath = (product) => {
    const sku = lamodaProductSku();
    if (!sku || !product) return true;
    const values = [
      product.sku,
      product.productID,
      product.mpn,
      product.url,
    ]
      .map((value) => cleanText(String(value || "")).toLowerCase())
      .filter(Boolean);
    if (values.length === 0) return true;
    return values.some((value) => value.includes(sku.toLowerCase()));
  };

  const tildaProductId = () =>
    location.pathname.match(/\/tproduct\/(\d+)(?:-[^/]+)?\/?$/i)?.[1] || null;

  const tildaProductRoot = () => {
    const productId = tildaProductId();
    if (!productId) return null;

    const candidates = [
      ...document.querySelectorAll(
        '.t-store__prod-popup, .js-store-product, .js-product, [data-product-lid], [data-product-gen-uid]',
      ),
    ];
    let best = null;
    let bestScore = -1;

    for (const root of candidates) {
      const attributes = [...root.attributes]
        .map((attribute) => attribute.value || "")
        .join(" ");
      const rect = root.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      const visible =
        rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < window.innerHeight * 2;
      const hasPrice = Boolean(
        root.matches("[data-product-price-def],[data-product-price]")
        || root.querySelector(
          '[data-product-price-def],[data-product-price],.js-product-price,.t-store__prod-popup__price-value',
        ),
      );
      const score =
        (attributes.includes(productId) ? 1000000000 : 0)
        + (visible ? 100000000 : 0)
        + (hasPrice ? 10000000 : 0)
        + area;
      if (score <= bestScore) continue;
      best = root;
      bestScore = score;
    }
    return best;
  };

  const tildaProductTitle = () => {
    const root = tildaProductRoot() || document;
    for (const selector of [
      ".js-store-prod-name",
      ".t-store__prod-popup__name",
      ".js-product-name",
      '[data-product-name]',
      ".t-store__prod-popup__title",
      "h1",
    ]) {
      for (const node of root.querySelectorAll(selector)) {
        const value =
          cleanText(node.getAttribute("data-product-name") || "")
          || cleanText(node.textContent || "");
        if (!value || value.length < 3 || value.length > 240) continue;
        if (/^(?:купить|в корзину|добавить|выберите размер)$/i.test(value)) continue;
        return value;
      }
    }
    return "";
  };

  const tildaProductImage = () => {
    const root = tildaProductRoot() || document;
    let best = "";
    let bestScore = -1;

    for (const img of root.querySelectorAll(
      '.t-store__prod-popup__slider img,.t-store__prod-popup__gallery img,.js-product-img,.t-product__img,img',
    )) {
      const raw =
        img.currentSrc
        || img.src
        || img.getAttribute("data-original")
        || img.getAttribute("data-src")
        || img.getAttribute("data-lazy-rule")
        || "";
      if (!raw) continue;

      let resolved;
      try {
        resolved = new URL(raw, location.href);
      } catch {
        continue;
      }
      if (!/^https?:$/i.test(resolved.protocol)) continue;

      const hint = [img.alt || "", resolved.href, img.className || ""]
        .join(" ")
        .toLowerCase();
      if (/(logo|icon|sprite|avatar|banner|payment|qr)/i.test(hint)) continue;

      const rect = img.getBoundingClientRect();
      const width = Math.max(rect.width || 0, img.naturalWidth || 0);
      const height = Math.max(rect.height || 0, img.naturalHeight || 0);
      if (width < 120 || height < 120) continue;

      const score =
        width * height
        + (/store__prod|product/i.test(hint) ? 1000000 : 0)
        + (rect.top >= -200 && rect.top <= window.innerHeight * 1.5 ? 500000 : 0);
      if (score <= bestScore) continue;
      best = resolved.href;
      bestScore = score;
    }
    return best;
  };

  const tildaProductPrice = () => {
    const root = tildaProductRoot() || document;
    const candidates = [
      root,
      ...root.querySelectorAll(
        '[data-product-price-def],[data-product-price],.js-product-price,.t-store__prod-popup__price-value,.t-store__prod-popup__price',
      ),
    ];

    for (const node of candidates) {
      const raw =
        node.getAttribute?.("data-product-price-def")
        || node.getAttribute?.("data-product-price")
        || "";
      const parsed = parsePrice(raw);
      if (parsed) return parsed;
    }

    for (const node of candidates) {
      const raw = cleanText(node.textContent || "");
      const match = raw.match(/(\d[\d \u00a0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|₸|\$|€)/i);
      const parsed = parsePrice(match?.[1]);
      if (parsed) return parsed;
    }
    return null;
  };

  const tildaProductCurrency = () => {
    const root = tildaProductRoot() || document;
    const raw = cleanText(root.textContent || "");
    if (/(?:₽|руб\.?)/i.test(raw)) return "RUB";
    if (/₸/.test(raw)) return "KZT";
    if (/€/.test(raw)) return "EUR";
    if (/\$/.test(raw)) return "USD";
    return null;
  };

  const knownProductPath = () => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "ozon.ru") return /\/product\//i.test(location.pathname);
    if (host === "wildberries.ru" || host.endsWith(".wildberries.ru")) {
      return /\/catalog\/\d+\/detail\.aspx/i.test(location.pathname);
    }
    if (host === "market.yandex.ru") {
      return /\/(?:product--[^/]+|product)\/\d+/i.test(location.pathname);
    }
    if (host === "lamoda.ru") return Boolean(lamodaProductSku());
    if (tildaProductId()) return true;
    return /\/(?:product|products)\/[^/]+/i.test(location.pathname);
  };

  const canonicalUrl = () => {
    const currentHost = location.hostname.toLowerCase().replace(/^www\./, "");
    const isWildberries = currentHost === "wildberries.ru" || currentHost.endsWith(".wildberries.ru");
    if (isWildberries && knownProductPath()) return location.href;
    if (currentHost === "lamoda.ru" && lamodaProductSku()) {
      return location.origin + location.pathname;
    }
    if (tildaProductId()) {
      return location.origin + location.pathname;
    }

    const raw =
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
      meta('meta[property="og:url"]') ||
      location.href;

    try {
      const parsed = new URL(raw, location.href);
      if (parsed.protocol !== "https:") return location.href;
      const currentHost = location.hostname.toLowerCase().replace(/^www\./, "");
      const parsedHost = parsed.hostname.toLowerCase().replace(/^www\./, "");
      return currentHost === parsedHost ? parsed.href : location.href;
    } catch {
      return location.href;
    }
  };

  const productTitle = (product) => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    const isWildberries = host === "wildberries.ru" || host.endsWith(".wildberries.ru");
    if (tildaProductId()) {
      const tildaTitle = tildaProductTitle();
      if (tildaTitle) return tildaTitle;
    }
    if (host === "lamoda.ru" && lamodaProductSku()) {
      const pageTitle = cleanText(document.title)
        .replace(/\s+[—-]\s+купить[\s\S]*$/i, "")
        .replace(/,\s*цвет:\s*[\s\S]*$/i, "")
        .trim();
      if (pageTitle && pageTitle.length >= 3 && pageTitle.length <= 240) {
        return pageTitle;
      }
    }
    const isGenericWildberriesTitle = (value) =>
      isWildberries && /(?:интернет.?магазин\s+wildberries|широкий ассортимент товаров)/i.test(cleanText(value));

    const imageAltTitle = () => {
      if (!isWildberries) return "";
      let best = "";
      let bestScore = -1;
      for (const img of document.querySelectorAll("img")) {
        const alt = cleanText(img.alt || img.getAttribute("alt") || "");
        if (!alt || alt.length < 3 || alt.length > 240 || isGenericWildberriesTitle(alt)) continue;
        const raw =
          img.currentSrc ||
          img.src ||
          img.getAttribute("data-src") ||
          img.getAttribute("data-original") ||
          "";
        const rect = img.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        const productImage = /wbbasket|\/images\/(?:big|c\d+)\//i.test(raw || "");
        const score = (productImage ? 1000000 : 0) + area;
        if (score <= bestScore) continue;
        best = alt;
        bestScore = score;
      }
      return best;
    };

    const selectors = [
      "h1",
      '[class*="product-page__title" i]',
      '[class*="product-title" i]',
      '[class*="product__title" i]',
      '[data-testid*="title" i]',
      'main [class*="title" i]',
      'main [class*="name" i]',
    ];
    let wildberriesTitle = "";
    if (isWildberries) {
      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          const value = cleanText(node.textContent || "");
          if (!value || value.length < 3 || value.length > 240) continue;
          if (isGenericWildberriesTitle(value)) continue;
          if (/^(?:в корзину|купить|добавить|отзывы|характеристики)$/i.test(value)) continue;
          if (/^\d[\d\s.,]*(?:₽|руб\.?|₸|\$|€)?$/i.test(value)) continue;
          wildberriesTitle = value;
          break;
        }
        if (wildberriesTitle) break;
      }
      if (!wildberriesTitle) wildberriesTitle = imageAltTitle();
    }

    return cleanText(product?.name || "") ||
      wildberriesTitle ||
      meta('meta[property="og:title"]') ||
      meta('meta[name="twitter:title"]') ||
      text("h1") ||
      cleanText(document.title);
  };

  const heroImage = (product) => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    const visibleHeroImage = () => {
      const roots = [
        document.querySelector('[data-widget*="gallery" i]'),
        document.querySelector('[class*="gallery" i]'),
        document.querySelector('[data-testid*="gallery" i]'),
        document.querySelector("main"),
      ].filter(Boolean);

      for (const root of roots) {
        const images = [...root.querySelectorAll("img")];
        for (const img of images) {
          const src = img.currentSrc || img.src || "";
          if (!/^https?:/i.test(src)) continue;
          const hint = ((img.alt || "") + " " + src).toLowerCase();
          if (/(logo|icon|sprite|avatar|banner|payment|qr)/.test(hint)) continue;
          const rect = img.getBoundingClientRect();
          if (rect.width < 120 || rect.height < 120) continue;
          return src;
        }
      }
      return "";
    };

    if (tildaProductId()) {
      const tildaImage = tildaProductImage();
      if (tildaImage) return tildaImage;
    }
    if (host === "lamoda.ru" && lamodaProductSku()) {
      const visible = visibleHeroImage();
      if (visible) return visible;
    }

    const ldImage = product?.image;
    const structured =
      (typeof ldImage === "string"
        ? ldImage
        : Array.isArray(ldImage)
          ? ldImage[0]
          : ldImage?.url) ||
      meta('meta[property="og:image"]') ||
      meta('meta[property="og:image:secure_url"]') ||
      meta('meta[name="twitter:image"]') ||
      document.querySelector('[itemprop="image"]')?.getAttribute("content") ||
      document.querySelector('img[itemprop="image"]')?.currentSrc ||
      document.querySelector('img[itemprop="image"]')?.src ||
      "";

    if (structured) {
      try {
        const resolved = new URL(structured, location.href);
        const host = location.hostname.toLowerCase().replace(/^www\./, "");
        const isWildberries = host === "wildberries.ru" || host.endsWith(".wildberries.ru");
        if (!(isWildberries && /(?:wb-og|\/site\/i\/)/i.test(resolved.href))) {
          return resolved.href;
        }
      } catch {}
    }

    return visibleHeroImage();
  };

  const productPrice = (product) => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    const visiblePrice = () => {
      const roots = [
        document.querySelector('[data-widget*="webPrice" i]'),
        document.querySelector('[data-widget*="price" i]'),
        document.querySelector('[itemprop="offers"]'),
        document.querySelector("main"),
      ].filter(Boolean);

      for (const root of roots) {
        const raw = cleanText(root.textContent || "");
        const matches = [...raw.matchAll(/(\d[\d \u00a0]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|₸|\$|€)/gi)];
        for (const match of matches) {
          const parsed = parsePrice(match[1]);
          if (parsed) return parsed;
        }
      }
      return null;
    };

    if (tildaProductId()) {
      const tildaPrice = tildaProductPrice();
      if (tildaPrice) return tildaPrice;
    }
    if (host === "lamoda.ru" && lamodaProductSku()) {
      const visible = visiblePrice();
      if (visible) return visible;
    }

    const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
    const structured =
      parsePrice(offers?.price) ||
      parsePrice(offers?.lowPrice) ||
      parsePrice(meta('meta[property="product:price:amount"]')) ||
      parsePrice(document.querySelector('[itemprop="price"]')?.getAttribute("content"));

    if (structured) return structured;
    if (tildaProductId()) return null;

    return visiblePrice();
  };

  const productCurrency = (product, price) => {
    if (tildaProductId()) {
      const tildaCurrency = tildaProductCurrency();
      if (tildaCurrency) return tildaCurrency;
    }
    const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
    const structured =
      cleanText(offers?.priceCurrency || "") ||
      meta('meta[property="product:price:currency"]') ||
      cleanText(document.querySelector('[itemprop="priceCurrency"]')?.getAttribute("content") || "");
    if (structured) return structured.toUpperCase().slice(0, 8);
    return price ? "RUB" : null;
  };

  const isProductPage = (product) => {
    if (product) return true;
    if (knownProductPath()) return true;

    const ogType = meta('meta[property="og:type"]').toLowerCase();
    if (ogType.includes("product")) return true;

    const hasTitle = Boolean(text("h1") || meta('meta[property="og:title"]'));
    const hasPrice =
      Boolean(meta('meta[property="product:price:amount"]')) ||
      Boolean(document.querySelector('[itemprop="price"]'));
    const hasImage =
      Boolean(meta('meta[property="og:image"]')) ||
      Boolean(document.querySelector('[itemprop="image"],img[itemprop="image"]'));

    return hasTitle && hasPrice && hasImage;
  };

  const productCapture = () => {
    const host = location.hostname.toLowerCase().replace(/^www\./, "");
    if (
      host === "litres.ru"
      || host === "afisha.yandex.ru"
      || host === "kudago.com"
      || host === "kassir.ru"
      || host.endsWith(".kassir.ru")
    ) return null;

    let product = findProductJsonLd();
    if (host === "lamoda.ru" && product && !lamodaProductMatchesPath(product)) {
      product = null;
    }
    if (!isProductPage(product)) return null;

    const title = productTitle(product);
    const isWildberries = host === "wildberries.ru" || host.endsWith(".wildberries.ru");
    const genericWildberriesTitle =
      isWildberries && /(?:интернет.?магазин\s+wildberries|широкий ассортимент товаров)/i.test(title);
    if (!title || genericWildberriesTitle) return null;

    const price = productPrice(product);
    return {
      kind: "product",
      sourceUrl: canonicalUrl(),
      title,
      imageUrl: heroImage(product) || null,
      price,
      currency: productCurrency(product, price),
      merchant: merchantName(),
      capturedAt: Date.now(),
    };
  };

  const captureForKind = (kind) => {
    if (kind === "product") return productCapture();
    if (kind === "game") return steamGameCapture();
    if (kind === "screen") return screenCapture();
    if (kind === "book") return litresBookCapture();
    if (kind === "place") return placeCapture();
    if (kind === "event") return tripComCapture() || kassirEventCapture() || eventCapture();
    if (kind === "hotel") return tripComHotelCapture() || yandexTravelHotelCapture();
    return steamGameCapture()
      || screenCapture()
      || litresBookCapture()
      || tripComCapture()
      || tripComHotelCapture()
      || yandexTravelHotelCapture()
      || placeCapture()
      || kassirEventCapture()
      || eventCapture()
      || productCapture();
  };


  const resultKey = "__paAndroidCaptureResult";
  globalThis[resultKey] = { done: false };
  let strongest = null;
  const usable = (item) =>
    item && typeof item === "object" && typeof item.sourceUrl === "string"
    && /^https:\/\//i.test(item.sourceUrl)
    && typeof item.title === "string" && item.title.trim().length >= 4
    && !/^(?:\.{3}|загрузка|loading|распродажа)$/i.test(item.title.trim());
  const complete = (item) => usable(item) &&
    (item.kind !== "product" || (item.imageUrl && item.price))
    && (item.kind !== "event" || (item.imageUrl && item.city && item.venueName));
  const attempts = [0, 700, 1700, 3400, 6000, 10000];
  attempts.forEach((delay, index) => {
    setTimeout(() => {
      if (globalThis[resultKey]?.done) return;
      try {
        const candidate = captureForKind("auto");
        if (usable(candidate)) {
          const score = (candidate.imageUrl ? 2 : 0)
            + (candidate.price ? 1 : 0) + (candidate.venueName ? 1 : 0);
          const previousScore = strongest ? (strongest.imageUrl ? 2 : 0)
            + (strongest.price ? 1 : 0) + (strongest.venueName ? 1 : 0) : -1;
          if (score > previousScore) strongest = candidate;
          if (complete(candidate)) {
            globalThis[resultKey] = { done: true, capture: candidate };
            return;
          }
        }
        if (index === attempts.length - 1) {
          globalThis[resultKey] = strongest
            ? { done: true, capture: strongest, incomplete: true }
            : { done: true, error: "Не удалось распознать карточку на странице." };
        }
      } catch (error) {
        if (index === attempts.length - 1) {
          globalThis[resultKey] = { done: true,
            error: String(error?.message || "Ошибка чтения страницы").slice(0, 250) };
        }
      }
    }, delay);
  });
})();