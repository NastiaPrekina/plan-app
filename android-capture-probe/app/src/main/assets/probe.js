(() => {
  const clean = (value, max = 600) => typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const meta = (key) => clean(document.querySelector('meta[property="' + key + '"]')?.content || document.querySelector('meta[name="' + key + '"]')?.content || "", 1000);
  const attr = (selector, key) => clean(document.querySelector(selector)?.getAttribute(key) || "", 1100);
  const resolve = (value) => {
    if (typeof value !== "string" || !value.trim() || /^data:|^blob:|^javascript:/i.test(value)) return "";
    try {
      const url = new URL(value.trim(), location.href);
      return url.protocol === "https:" ? url.href : "";
    } catch (_) { return ""; }
  };
  const isGenericImage = (value) => /(?:wb-og|\/site\/i\/|logo|sprite|placeholder|favicon|icon|(?:\\/|^)avatar(?:\\/|\\.)|badge|1x1|pixel|\/ads?\/|yastatic-net\.ru\/s3\/afisha-frontend\/static)/i.test(value || "");
  const isGenericTitle = (value) => /(?:интернет.?магазин\s+wildberries|широкий ассортимент товаров)/i.test(value || "");
  const isPriceText = (value) => /^\d[\d\s.,]*(?:₽|руб\.?|₸|\$|€)?$/i.test(value || "");
  const isPromotionalTitle = (value) => /^(?:распродажа|скидки?|акция|хит|хит продаж|новинка|бестселлер|реклама|спецпредложение|распродажа товаров)$/i.test(clean(value));
  const isUsableProductTitle = (value) => clean(value).length >= 9 && clean(value).split(" ").length >= 2 && !isGenericTitle(value) && !isPriceText(value) && !isPromotionalTitle(value);
  const host = location.hostname.toLowerCase().replace(/^www\./, "");
  const path = location.pathname;
  const isWB = host === "wildberries.ru" || host.endsWith(".wildberries.ru");
  const isOzon = host === "ozon.ru" || host.endsWith(".ozon.ru");
  const isKP = host === "kinopoisk.ru" || host.endsWith(".kinopoisk.ru");

  const ldNodes = [];
  const walk = (value, depth = 0) => {
    if (depth > 5 || ldNodes.length >= 80 || !value) return;
    if (Array.isArray(value)) { for (const child of value.slice(0, 30)) walk(child, depth + 1); return; }
    if (typeof value !== "object") return;
    ldNodes.push(value);
    if (value["@graph"]) walk(value["@graph"], depth + 1);
  };
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 20);
  for (const script of scripts) {
    try { walk(JSON.parse(script.textContent || "{}")); } catch (_) {}
  }
  const typesOf = (node) => {
    const t = node?.["@type"];
    return Array.isArray(t) ? t : t ? [t] : [];
  };
  const hasType = (node, expected) => typesOf(node).some((t) => typeof t === "string" && expected.includes(t.split("/").pop()));
  const movie = ldNodes.find((node) => hasType(node, ["Movie", "TVMovie", "TVSeries", "TVMiniSeries"]));
  const product = ldNodes.find((node) => hasType(node, ["Product"]));
  let category = isKP && /^\/(film|series)\/\d+/i.test(path)
    ? (movie && hasType(movie, ["TVSeries", "TVMiniSeries"]) ? "series" : /^\/series\//i.test(path) ? "series" : "movie")
    : isWB || isOzon || product ? "product" : movie ? "movie" : "unknown";

  const imageFromLd = (node) => {
    const raw = node?.image;
    if (typeof raw === "string") return resolve(raw);
    if (Array.isArray(raw)) return raw.map((entry) => typeof entry === "string" ? resolve(entry) : resolve(entry?.url || entry?.contentUrl)).find(Boolean) || "";
    return resolve(raw?.url || raw?.contentUrl);
  };
  const ogImage = resolve(meta("og:image")) || "";
  const structuredImage = imageFromLd(category === "product" ? product : movie);
  const images = [];
  for (const img of Array.from(document.images || []).slice(0, 220)) {
    const raw = img.currentSrc || img.getAttribute("data-src") || img.getAttribute("data-original") || img.src || "";
    const url = resolve(raw);
    if (!url || isGenericImage(url)) continue;
    const rect = img.getBoundingClientRect();
    const width = Math.round(rect.width || 0), height = Math.round(rect.height || 0);
    if (width < 100 || height < 100) continue;
    const alt = clean(img.getAttribute("alt") || "", 140);
    let score = width * height;
    if (isWB && /wbbasket|wbstatic|\/images\/(?:big|c\d+)\//i.test(url)) score += 1000000;
    if (isKP && /kinopoisk-image|kinopoisk.ru\/images/i.test(url)) score += 1000000;
    if (/product|gallery|poster/i.test(url + " " + alt)) score += 300000;
    images.push({url, alt, width, height, score});
  }
  images.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const imageOptions = [];
  for (const img of images) {
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    imageOptions.push({url: img.url, alt: img.alt, width: img.width, height: img.height});
    if (imageOptions.length >= 6) break;
  }

  const titleFromPage = clean(document.title, 360);
  const ordinaryH1 = clean(document.querySelector("h1")?.innerText || "", 250);
  let visibleTitle = ordinaryH1;
  let titleSource = ordinaryH1 ? "h1" : "unknown";
  if (isWB) {
    // Wildberries product pages may render promotional banners as DOM titles
    // and a rating inside h1. A product-specific HTML title is more reliable.
    const productId = path.match(/^\/catalog\/(\d+)\/detail\.aspx/i)?.[1] || "";
    const hasProductPageTitle = Boolean(productId && /wildberries/i.test(titleFromPage) && /\s+купить(?:\s+за)?\s+/i.test(titleFromPage));
    const fromDocumentTitle = hasProductPageTitle
      ? clean(titleFromPage.split(/\s+купить(?:\s+за)?\s+/i)[0], 300).replace(new RegExp("\\s+" + productId + "$"), "").trim()
      : "";
    const selectors = ['[class*="product-page__title" i]','[class*="product-title" i]','[class*="product__title" i]','[data-testid*="title" i]','main [class*="title" i]','main [class*="name" i]'];
    const values = selectors.flatMap((sel) => Array.from(document.querySelectorAll(sel)).slice(0, 6).map((el) => clean(el.textContent || "", 260)));
    const fromDom = values.find(isUsableProductTitle) || "";
    visibleTitle = isUsableProductTitle(fromDocumentTitle) ? fromDocumentTitle : fromDom;
    titleSource = visibleTitle === fromDocumentTitle && visibleTitle ? "product_page_title" : visibleTitle ? "product_dom" : "unknown";
  }

  if ((category === "movie" || category === "series") && movie?.name) titleSource = "jsonld_movie";
  if (category === "product" && product?.name) titleSource = "jsonld_product";
  let captureTitle = clean((category === "product" ? product?.name : movie?.name) || "", 250)
    || visibleTitle || clean(meta("og:title"), 250) || titleFromPage;
  if (category === "movie" || category === "series") {
    captureTitle = captureTitle.replace(/\s*\(\d{4}\)\s*$/,"").replace(/\s*[—-]\s*Кинопоиск.*$/i,"");
  }

  const text = (document.body?.innerText || "").slice(0, 160000);
  const priceRe = /(\d{1,3}(?:[\s\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(₽|руб(?:\.|ля|лей)?|€|\$)/ig;
  const priceObservations = [];
  for (let match; (match = priceRe.exec(text)) && priceObservations.length < 7;) {
    const value = clean(match[0], 90);
    if (priceObservations.some((entry) => entry.price === value)) continue;
    priceObservations.push({
      price: value,
      context: clean(text.slice(Math.max(0, match.index - 65), Math.min(text.length, match.index + match[0].length + 65)), 160)
    });
  }
  const prices = priceObservations.map((entry) => entry.price);
  const offer = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  const structuredPrice = clean(String(offer?.price || offer?.lowPrice || ""), 90);
  // These are observations, not an authoritative price selector. User-visible
  // main-product price needs context-aware verification in the real parser.
  const capturePriceCandidate = category === "product" ? (prices[0] || (structuredPrice ? structuredPrice + " (JSON-LD)" : "")) : "";

  const firstCandidateImage = imageOptions[0]?.url || "";
  let captureImage = (category === "movie" || category === "series")
    ? structuredImage || (ogImage && !isGenericImage(ogImage) ? ogImage : firstCandidateImage)
    : (isWB
      ? firstCandidateImage || (structuredImage && !isGenericImage(structuredImage) ? structuredImage : "")
      : structuredImage || (ogImage && !isGenericImage(ogImage) ? ogImage : firstCandidateImage));
  const matchId = isKP ? path.match(/^\/(?:film|series)\/(\d+)/i) : isWB ? path.match(/^\/catalog\/(\d+)/i) : isOzon ? path.match(/-(\d+)\/?$/) : null;


  const steamId = host === "store.steampowered.com" ? path.match(/^\/(?:app|agecheck\/app)\/(\d+)(?:\/|$)/i)?.[1] : "";
  const bookMatch = host === "litres.ru" ? path.match(/^\/(book|audiobook)\/[^/]+\/[^/]+-(\d+)\/?$/i) : null;
  const eventHost = host === "afisha.yandex.ru" || host === "kudago.com" || host === "kassir.ru" || host.endsWith(".kassir.ru");
  const mapHost = /^(?:maps\.google\.(?:com|ru)|(?:www\.)?google\.(?:com|ru)|(?:www\.)?yandex\.(?:ru|com|kz)|(?:www\.)?tripadvisor\.(?:com|ru)|(?:www\.)?restoclub\.ru)$/.test(host);
  const looksMapPage = /\/maps\/|\/maps\/place|\/maps\/search|\/org\/|\/Restaurant_Review|\/restaurant\//i.test(path);
  const bookEntity = ldNodes.find(node => hasType(node, ["Book", "AudioBook", "Audiobook"]));
  const gameEntity = ldNodes.find(node => hasType(node, ["VideoGame", "SoftwareApplication"]));
  // A page may list several unrelated events in JSON-LD. Never pick the first.
  const eventNodes = ldNodes.filter(node => typesOf(node).some(v =>
    /(?:Event|Festival)$/i.test(String(v).split("/").pop())));
  const normPath = (value) => {
    if (!value || typeof value !== "string") return "";
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "https:" || url.hostname !== location.hostname) return "";
      return url.pathname.replace(/\/+$/, "") || "/";
    } catch (_) { return ""; }
  };
  const normTitle = (value) => clean(value, 260).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim();
  const sameEventTitle = (entity, page) => {
    const a = normTitle(entity?.name || ""), b = normTitle(page);
    return a.length >= 6 && b.length >= 6 && (a === b || b.startsWith(a + " ") || a.startsWith(b + " "));
  };
  const eventCandidates = eventNodes.filter(node => {
    const urls = [node.url, node["@id"], node.mainEntityOfPage?.["@id"], node.mainEntityOfPage?.url];
    return urls.some(v => normPath(v) === (location.pathname.replace(/\/+$/, "") || "/"));
  });
  const pageHeadings = [
    document.querySelector("h1")?.textContent || "",
    meta("og:title"),
    document.title
  ].filter(Boolean);
  // URL match is strongest; otherwise accept a unique heading match only.
  const headingMatches = eventNodes.filter(node => {
    const explicitUrls = [node.url, node["@id"], node.mainEntityOfPage?.url, node.mainEntityOfPage?.["@id"]]
      .filter(v => typeof v === "string" && /^https?:\/\//i.test(v));
    const conflicts = explicitUrls.some(v => normPath(v) !== (location.pathname.replace(/\/+$/, "") || "/"));
    return !conflicts && pageHeadings.some(heading => sameEventTitle(node, heading));
  });
  const eventEntity = eventCandidates.length === 1 ? eventCandidates[0] :
    headingMatches.length === 1 ? headingMatches[0] : null;
  const eventMatchSource = eventCandidates.length === 1 ? "jsonld_url" :
    headingMatches.length === 1 ? "jsonld_title" : "unverified";
  const foodTypes = ["Restaurant","CafeOrCoffeeShop","BarOrPub","Bakery","FoodEstablishment","FastFoodRestaurant"];
  const foodEntity = ldNodes.find(node => hasType(node, foodTypes));
  const nonFoodEntity = ldNodes.find(node => hasType(node, ["Museum","Hotel","Store","Park","Pharmacy","BeautySalon","Zoo","ShoppingCenter","TouristAttraction","MovieTheater"]));
  const placeEntity = foodEntity || ldNodes.find(node => hasType(node, ["LocalBusiness", "Place"]));
  const ldPeople = (raw) => (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map(v => clean(typeof v === "string" ? v : (v?.name || v?.alternateName || ""), 140))
    .filter(Boolean).slice(0, 8);
  const ldGenres = (entity) => {
    const raw=entity?.genre;
    return (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []).map(v=>clean(String(v),90)).filter(Boolean).slice(0, 16);
  };
  const pageYear = (value) => clean(String(value || ""), 110).match(/\b(18|19|20|21)\d{2}\b/)?.[0] || "";
  const numericYear = (value) => { const s = pageYear(value); return s ? Number(s) : null; };
  const isRealImageUrl = (value) => !!value && !isGenericImage(value) &&
    /(?:\.(?:png|jpe?g|webp|avif)(?:[?#]|$)|\/(?:orig|large|medium|small|\d+x\d+)(?:[?#]|$)|\/get-[^/]+\/|\/images\/)/i.test(value);
  const eventCity = (value) => ({
    "spb": "Санкт-Петербург", "saint-petersburg": "Санкт-Петербург",
    "moscow": "Москва", "msk": "Москва", "kazan": "Казань",
    "ekaterinburg": "Екатеринбург", "novosibirsk": "Новосибирск"
  })[value] || "";
  const isoDay = (raw) => clean(raw || "", 75).match(/(?:^|[^\d])(20\d{2}-\d{2}-\d{2})(?!\d)/)?.[1] || "";
  const isoTime = (raw) => clean(raw || "", 75).match(/[T ](\d{2}:\d{2})/)?.[1] || "";
  const nowIso = new Date().toISOString().slice(0,10);
  const fixedUrl = (url) => url.split("?")[0].split("#")[0];
  const productCanonical = resolve(attr('link[rel="canonical"]', 'href'));
  let sourceUrl = fixedUrl(location.href);
  let sourceProvider = host;
  let externalId = matchId?.[1] || "";
  let sourceDescription = clean((category === "movie" || category === "series" ? movie?.description : product?.description) || meta("og:description") || meta("description"), 1000);
  let extra = {};
  if (steamId) {
    category = "game";
    sourceProvider = "steam";
    externalId = steamId;
    sourceUrl = "https://store.steampowered.com/app/" + steamId + "/";
    captureTitle = clean(document.querySelector(".apphub_AppName")?.textContent || gameEntity?.name || meta("og:title").replace(/\s+on Steam$/i, "") || titleFromPage.replace(/\s+on Steam$/i, ""), 250);
    titleSource = "steam";
    captureImage = resolve(document.querySelector(".game_header_image_full")?.currentSrc || document.querySelector(".game_header_image_full")?.src || "") || imageFromLd(gameEntity) || captureImage;
    const tags = Array.from(document.querySelectorAll(".glance_tags.popular_tags a.app_tag, a.app_tag")).slice(0, 18).map(el => clean(el.textContent, 90)).filter(Boolean);
    extra = {
      steamAppId: steamId,
      year: numericYear(document.querySelector(".release_date .date")?.textContent || gameEntity?.datePublished),
      genres: ldGenres(gameEntity),
      tags,
      platforms: ["win","mac","linux"].filter(p => document.querySelector(".platform_img." + p)).map(p=>p==="win"?"Windows":p==="mac"?"macOS":"Linux"),
      coop: /online co-op|shared\/split screen|remote play together/i.test(text),
      description: clean(document.querySelector(".game_description_snippet")?.textContent || gameEntity?.description || meta("description"), 1000)
    };
    sourceDescription = extra.description;
  } else if (bookMatch) {
    category = bookMatch[1] === "audiobook" ? "audiobook" : "book";
    sourceProvider = "litres";
    externalId = bookMatch[2];
    sourceUrl = fixedUrl(location.href);
    captureTitle = clean(bookEntity?.name || document.querySelector("h1")?.textContent || meta("og:title").replace(/\s+[—–-]\s+.*Литрес.*$/i,""),250);
    titleSource = bookEntity?.name ? "jsonld_book" : "page";
    captureImage = imageFromLd(bookEntity) || (ogImage && !isGenericImage(ogImage) ? ogImage : "") || captureImage;
    const authors = ldPeople(bookEntity?.author);
    if (!authors.length) {
      for (const anchor of Array.from(document.querySelectorAll('main a[href*="/author/"]')).slice(0,6)) {
        const name=clean(anchor.textContent,140);
        if(name&&!authors.includes(name)) authors.push(name);
      }
    }
    const pagesRaw = text.match(/Объем\s*:?\s*([\d\s]+)\s*(?:стр\.|страниц|страница|страницы)/i)?.[1]||"";
    const duration=text.match(/Длительность(?: книги)?\s+(?:(\d+)\s*ч\.?)?\s*(?:(\d+)\s*мин\.?)?/i);
    extra = {
      authors,
      year: numericYear(bookEntity?.datePublished||bookEntity?.dateCreated||text.match(/Дата (?:написания|перевода):\s*((?:18|19|20|21)\d{2})/i)?.[1]),
      genres: ldGenres(bookEntity),
      pages:pagesRaw?Number(pagesRaw.replace(/\D/g,""))||null:null,
      isbn:clean(text.match(/ISBN\s*:?\s*([0-9Xx-]{10,32})/i)?.[1]||"",40),
      textAvailable:category==="book",
      audioAvailable:category==="audiobook",
      audioDurationMinutes:duration?(Number(duration[1]||0)*60+Number(duration[2]||0))||null:null,
      description:clean(bookEntity?.description||meta("description")||meta("og:description"),1000)
    };
    sourceDescription=extra.description;
  } else if (eventHost && (
    (host === "afisha.yandex.ru" && /^\/[^/]+\/(?!search\/|places\/|selections\/|cinema\/)[^/]+\/[^/]+\/?$/i.test(path))
    || (host === "kudago.com" && /\/event\//i.test(path))
    || (/kassir\.ru$/.test(host) && path.split("/").filter(Boolean).length >= 2)
    || eventEntity
  )) {
    category = "event";
    sourceProvider = host === "afisha.yandex.ru" ? "yandex_afisha" : host === "kudago.com" ? "kudago" : "kassir";
    const parts = path.split("/").filter(Boolean);
    const providerCategory = sourceProvider === "yandex_afisha" ? parts[1] || "" :
      sourceProvider === "kassir" ? parts[0] || "" : "event";
    externalId = sourceProvider === "yandex_afisha" ? parts.join("/") :
      sourceProvider === "kudago" ? parts.join("/") :
      host + (path.replace(/\/+$/, "") || "/");
    const eventHead = clean(ordinaryH1 && ordinaryH1.length > 4 ? ordinaryH1 :
      meta("og:title") || titleFromPage,250).replace(/\s*[—|]\s*(?:КудаГо|KudaGo|Яндекс Афиша|KASSIR).*$/i,"");
    captureTitle = clean(eventEntity?.name || eventHead, 250);
    titleSource = eventEntity ? eventMatchSource : "page_unverified";
    const candidateImage = imageFromLd(eventEntity);
    const ogEventImage = isRealImageUrl(ogImage) ? ogImage : "";
    captureImage = isRealImageUrl(candidateImage) ? candidateImage :
      eventEntity && ogEventImage ? ogEventImage : "";
    const place = eventEntity?.location;
    const placeObject = Array.isArray(place) ? place[0] : place;
    const addr = placeObject?.address;
    const address = clean(typeof addr === "string" ? addr : addr?.streetAddress || "",250);
    const slugCity = sourceProvider === "kassir" ? eventCity(host.split(".")[0]) :
      eventCity(parts[0]);
    const city = clean(addr?.addressLocality || slugCity,120);
    const rawStart = clean(eventEntity?.startDate || "",70);
    const rawEnd = clean(eventEntity?.endDate || "",70);
    const startDate = isoDay(rawStart), endDate = isoDay(rawEnd);
    const concert = providerCategory === "concert" || providerCategory === "koncert" ||
      (eventEntity && hasType(eventEntity, ["MusicEvent"]));
    const eventCategory = concert ? "concert" : "activity";
    const showType = /circus|cirk|shou|театр|theat|performance/i.test(providerCategory) ?
      "theatre_show" : /exhib|vyistav|выстав/i.test(providerCategory + " " + captureTitle) ?
      "exhibition" : /экскурс|excursion|tourist/i.test(providerCategory + " " + captureTitle) ?
      "excursion" : "other";
    const rawVenue = clean(placeObject?.name || "",220);
    const validVenue = rawVenue && normTitle(rawVenue) !== normTitle(city) &&
      !/^(?:Санкт-Петербург|Москва|Россия|Saint Petersburg|Moscow)(?:,\s*Россия)?$/i.test(rawVenue);
    const venueName = validVenue ? rawVenue : "";
    const scheduleDays = startDate && endDate ?
      (Date.parse(endDate+"T00:00:00Z")-Date.parse(startDate+"T00:00:00Z"))/86400000 : 0;
    const dateAmbiguous = concert && (scheduleDays > 2 || (startDate && startDate < nowIso));
    extra = {
      category: eventCategory,
      country: "Россия",
      city, venueName,
      address,
      startDate, endDate, startTime:isoTime(rawStart)||null,
      occurrenceType: eventCategory==="activity" ?
        (startDate && endDate && startDate!==endDate ? "date_range" : startDate ? "fixed_event" : "recurring_booking") : null,
      activityType: eventCategory==="activity" ? showType : null,
      tags:[providerCategory,showType].filter(Boolean),
      artistName:eventCategory==="concert"?captureTitle:null,
      dateAmbiguous,
      eventMatchSource,
      description:clean(eventEntity?.description||meta("description")||meta("og:description"),1000)
    };
    sourceDescription=extra.description;
  } else if (mapHost && (looksMapPage || placeEntity)) {
    const placeTypes=(placeEntity?typesOf(placeEntity):[]);
    const sourceEvidence=(placeTypes.join(" ")+" "+meta("og:description")+" "+text.slice(0,1500)).toLowerCase();
    const isNonFood = Boolean(nonFoodEntity) || /\bMuseum\b|\bHotel\b|\bStore\b|\bPark\b|\bPharmacy\b|\bBeautySalon\b|\bZoo\b|\bShoppingCenter\b/i.test(placeTypes.join(" "));
    const matchesFood = foodEntity || /кофейн|кофейня|кафе|ресторан|бар\b|пиццер|пекар|булоч|coffee shop|\bcafe\b|\brestaurant\b|\bbakery\b|\bbistro\b|\bpub\b/i.test(sourceEvidence);
    // Do not misclassify a museum/hotel as a restaurant because of ads/reviews.
    if(matchesFood && !isNonFood) {
      category="place";
      sourceProvider=/yandex/.test(host)?"yandex_maps":/google/.test(host)?"google_maps":/tripadvisor/.test(host)?"tripadvisor":"restoclub";
      captureTitle=clean(placeEntity?.name||meta("og:title")||titleFromPage,250).replace(/\s*[—|]\s*(?:Яндекс Карты|Yandex Maps|Google Maps|Tripadvisor|Restoclub).*$/i,"");
      titleSource=placeEntity?.name?"jsonld_place":"page";
      captureImage=imageFromLd(placeEntity)||(ogImage&&!isGenericImage(ogImage)?ogImage:"")||captureImage;
      const addr=placeEntity?.address;
      const adr=typeof addr==="object"&&addr?addr:{};
      let placeType="restaurant";
      if(/кофейня|кофейн|coffee shop|CafeOrCoffeeShop/i.test(sourceEvidence))placeType="coffee_shop";
      else if(/паб|бар\b|\bpub\b|BarOrPub/i.test(sourceEvidence))placeType="bar";
      else if(/пекар|булоч|\bbakery\b|кафе|\bcafe\b/i.test(sourceEvidence))placeType="cafe";
      extra={
        placeType,
        address:clean(typeof addr==="string"?addr:adr.streetAddress||"",250),
        city:clean(adr.addressLocality||"",140),
        country:clean(typeof adr.addressCountry==="string"?adr.addressCountry:adr.addressCountry?.name||"",120),
        rating:placeEntity?.aggregateRating?.ratingValue||null,
        description:clean(placeEntity?.description||meta("description")||meta("og:description"),1000)
      };
      sourceDescription=extra.description;
    }
  } else if (category === "movie" || category === "series") {
    sourceProvider="kinopoisk";
    sourceUrl="https://www.kinopoisk.ru/"+(category==="series"?"series":"film")+"/"+externalId+"/";
    extra={
      year:numericYear(movie?.datePublished||movie?.dateCreated||movie?.copyrightYear||titleFromPage),
      originalTitle:clean(movie?.alternateName||"",200),
      genres:ldGenres(movie),
      description:clean(movie?.description||meta("og:description"),1000)
    };
    sourceDescription=extra.description;
  } else if (category === "product") {
    sourceProvider=isWB?"wildberries":isOzon?"ozon":host==="market.yandex.ru"?"yandex_market":host;
    sourceUrl=isWB?fixedUrl(location.href):productCanonical||fixedUrl(location.href);
    if(host === "market.yandex.ru") externalId = path.match(/\/(\d{6,})(?:\/)?$/)?.[1] || externalId;
    extra={merchant:isWB?"Wildberries":isOzon?"Ozon":host==="market.yandex.ru"?"Яндекс Маркет":host};
  }

  const kind = category==="movie"||category==="series"?"screen":category==="audiobook"?"book":category;
  const normalizedPrice=category==="product"&&capturePriceCandidate ? Number(capturePriceCandidate.replace(/[^\d,\.]/g,"").replace(/\s/g,"").replace(",",".")) : null;
  const valuePrice=Number.isFinite(normalizedPrice)&&normalizedPrice>0?normalizedPrice:null;
  const firstPriceContext = priceObservations[0]?.context || "";
  const priceContextAfter = firstPriceContext.slice(
    firstPriceContext.indexOf(capturePriceCandidate) + capturePriceCandidate.length,
    firstPriceContext.indexOf(capturePriceCandidate) + capturePriceCandidate.length + 37
  );
  const conditionalPrice = category==="product" && valuePrice &&
    /^(?:\s|[.,;:—-])*(?:с банками|пэй|pay|с картой|по карте|при оплате|по подписке|для подписчиков)(?![а-яёa-z])/i.test(priceContextAfter);
  const priceWarning = conditionalPrice ? "Цена с условиями оплаты" : "";
  const unsafeEventMatch = category==="event" && !eventEntity;
  const capture = category==="unknown"?null:{
    kind,
    sourceProvider,
    sourceUrl,
    externalId,
    title:captureTitle,
    imageUrl:captureImage||null,
    description:sourceDescription||null,
    ...(category==="movie"||category==="series"?{category}:{}),
    ...(category==="product"?{price:valuePrice,currency:valuePrice?"RUB":null}:{}),
    ...extra
  };
  const missingFields=[];
  if(!captureTitle||captureTitle==="..."||captureTitle.length<4||isPromotionalTitle(captureTitle)||isGenericTitle(captureTitle))missingFields.push("Название");
  if(!captureImage)missingFields.push("Изображение");
  if(category==="product"&&!valuePrice)missingFields.push("Цена");
  if(priceWarning)missingFields.push(priceWarning);
  if(category==="book"||category==="audiobook") {
    if(!extra.authors?.length)missingFields.push("Автор");
  }
  if(category==="place") {
    if(!extra.address)missingFields.push("Адрес");
    if(!extra.city)missingFields.push("Город");
  }
  if(category==="event") {
    if(unsafeEventMatch)missingFields.push("Нет подтверждения события из разметки страницы");
    if(!extra.startDate)missingFields.push("Дата");
    if(extra.dateAmbiguous)missingFields.push("Дата и сеанс требуют уточнения");
    if(!extra.venueName)missingFields.push("Место проведения");
    if(!extra.city)missingFields.push("Город");
    if(!extra.address)missingFields.push("Адрес");
  }
  if(category==="unknown")missingFields.push("Категория не определена");
  const captureReady=category!=="unknown"&&missingFields.length===0;

  return JSON.stringify({
    version: 6,
    pageUrl: location.href,
    pageTitle: titleFromPage,
    readyState: document.readyState,
    canonical: resolve(attr('link[rel="canonical"]', "href")),
    detectedCategory: category,
    sourceProvider,
    externalId, 
    sourceUrl,
    eventMatchSource:category==="event"?eventMatchSource:"",
    captureReady,
    missingFields,
    capture,
    h1: ordinaryH1,
    ogTitle: meta("og:title"),
    ogImage: ogImage,
    ogDescription: meta("og:description"),
    captureTitle,
    titleSource,
    captureImage,
    capturePriceCandidate,
    priceWarning,
    priceCandidates: category === "product" ? prices : [],
    priceObservations: category === "product" ? priceObservations : [],
    priceCandidateSource: category === "product" && prices.length ? "first_visible_text_unverified" : "",
    structuredPrice: category === "product" ? structuredPrice : "",
    imageOptions,
    structuredImage,
    yearCandidate: category==="movie"||category==="series"?String(extra.year||""): "",
    genres: extra.genres || [],
    originalTitle: extra.originalTitle || "",
    jsonLdTypes: ldNodes.map((node) => typesOf(node).join(",")).filter(Boolean).slice(0, 8),
    jsonLdNames: ldNodes.map((node) => clean(node.name || "", 200)).filter(Boolean).slice(0, 6),
    foundJsonLdBlocks: scripts.length,
    problemHint: isWB && !captureImage ? "Wildberries: фото товара пока не найдено в DOM" :
      (category === "movie" || category === "series") && !structuredImage
        ? "Для постера нет JSON-LD изображения, использована другая обложка" : ""
  });
})()
