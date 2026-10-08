const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname,'../app/src/main/assets/probe.js'),'utf8');

function run({url,title,body='',og={},jsonLd=[],h1='',promo='',images=[]}) {
  const uri = new URL(url);
  const metas = Object.entries(og).map(([key,value])=>[key,{content:value}]);
  const metaMap = new Map(metas);
  const entries = jsonLd.map(x=>({textContent:JSON.stringify(x)}));
  const imageElements=images.map(img=>({
    currentSrc:img.url,
    src:img.url,
    getAttribute(key){return key==='alt'?img.alt: key==='data-src'?null :null},
    getBoundingClientRect(){return {width:img.width||369,height:img.height||492}}
  }));
  const document = {
    title,
    body:{innerText:body},
    images:imageElements,
    querySelector(sel) {
      if(sel==='h1') return {innerText:h1};
      const m=sel.match(/^meta\[(?:property|name)="([^"]+)"\]$/);
      if(m) return metaMap.get(m[1])||null;
      if(sel==='link[rel="canonical"]') return {getAttribute(k){return k==='href'?url.split('?')[0]:null}};
      return null;
    },
    querySelectorAll(sel) {
      if(sel==='script[type="application/ld+json"]') return entries;
      if(sel==='main [class*="title" i]'&&promo) return [{textContent:promo}];
      return [];
    }
  };
  return JSON.parse(vm.runInNewContext(script,{document,location:{href:url,pathname:uri.pathname,hostname:uri.hostname},URL}));
}

test('Wildberries prioritizes product title over SALE tag and h1 rating',()=>{
  const o=run({url:'https://www.wildberries.ru/catalog/569909841/detail.aspx?size=781087423',
    title:'Шины зимние R15 185 65 88 T W01 ATTAR 569909841 купить за 4 387 ₽ в интернет-магазине Wildberries',
    h1:'4,9',promo:'РАСПРОДАЖА',
    og:{'og:title':'Интернет-магазин Wildberries: широкий ассортимент товаров - скидки каждый день!', 'og:image':'https://static-basket-01.wbbasket.ru/vol2/site/i/wb-og-win.jpg'},
    body:'Шины зимние 4 299 ₽ 4 387 ₽',
    images:[{url:'https://basket-29.wbbasket.ru/vol5699/part569909/569909841/images/big/1.webp',alt:'Product image 1',width:369,height:492}]
  });
  assert.equal(o.version,6);
  assert.equal(o.detectedCategory,'product');
  assert.equal(o.externalId,'569909841');
  assert.equal(o.captureTitle,'Шины зимние R15 185 65 88 T W01 ATTAR');
  assert.equal(o.titleSource,'product_page_title');
  assert.ok(o.captureImage.endsWith('/1.webp'));
  assert.equal(o.capturePriceCandidate,'4 299 ₽');
  assert.equal(o.priceObservations[0].price,'4 299 ₽');
});
test('Kinopoisk retrieves portrait Movie image, no prices',()=>{
  const image='https://avatars.mds.yandex.net/get-kinopoisk-image/4486454/742a06fe-6de4-45b8-8f55-3d1ec279bcb0/600x900';
  const o=run({url:'https://www.kinopoisk.ru/film/5069690/?utm_source=test',
    title:'Земмельвейс, 2023 — смотреть фильм — Кинопоиск',
    og:{'og:title':'«Земмельвейс» (Semmelweis, 2023)','og:image':'https://avatars.mds.yandex.net/some/1200x630'},
    jsonLd:[{'@type':'Movie',name:'Земмельвейс',image,datePublished:'2023-06-01',genre:['драма','биография','история'],alternateName:'Semmelweis'}],
    body:'Купить просмотр за 449 ₽'
  });
  assert.equal(o.detectedCategory,'movie');
  assert.equal(o.captureTitle,'Земмельвейс');
  assert.equal(o.captureImage,image);
  assert.equal(o.yearCandidate,'2023');
  assert.equal(o.priceCandidates.length,0);
  assert.equal(o.capturePriceCandidate,'');
});
test('Ozon keeps visible discounted price instead of structured price',()=>{
  const image='https://ir.ozone.ru/s3/multimedia-1-d/c600/8587945633.jpg';
  const o=run({url:'https://www.ozon.ru/product/britva-1657595919/',
    title:'Бритва Gillette Fusion5 ProGlide купить на Ozon',
    og:{'og:image':image},
    jsonLd:[{'@type':'Product',name:'Бритва Gillette Fusion5 ProGlide',offers:{price:'1499'},image}],
    body:'Цена сегодня 1 484 ₽ без скидки 1 499 ₽'
  });
  assert.equal(o.detectedCategory,'product');
  assert.equal(o.captureTitle,'Бритва Gillette Fusion5 ProGlide');
  assert.equal(o.capturePriceCandidate,'1 484 ₽');
  assert.equal(o.structuredPrice,'1499');
});


test('Steam share produces game capture with platform category and app ID',()=>{
  const o=run({url:'https://store.steampowered.com/app/1091500/Cyberpunk_2077/?from=share',
    title:'Cyberpunk 2077 on Steam',og:{'og:title':'Cyberpunk 2077 on Steam','og:image':'https://cdn.akamai.steamstatic.com/steam/apps/1091500/header.jpg'},
    jsonLd:[{'@type':'VideoGame',name:'Cyberpunk 2077',genre:['RPG','Action'],datePublished:'2020-12-10'}],
    body:'Release Date 2020 Windows Online co-op'
  });
  assert.equal(o.detectedCategory,'game');
  assert.equal(o.externalId,'1091500');
  assert.equal(o.capture.kind,'game');
  assert.equal(o.capture.steamAppId,'1091500');
  assert.equal(o.capture.title,'Cyberpunk 2077');
  assert.match(o.capture.sourceUrl,/^https:\/\/store\.steampowered\.com\/app\/1091500\/$/);
});
test('LitRes records book author and cover as separate category',()=>{
  const o=run({url:'https://www.litres.ru/book/author/name-12345678/',
    title:'Название книги — Литрес',
    og:{'og:title':'Название книги — Литрес'},
    jsonLd:[{'@type':'Book',name:'Название книги',author:[{name:'Автор Книги'}],image:'https://cdn.litres.ru/books/cover.jpg',genre:['Роман'],datePublished:'2020-01-01'}],
    body:'Дата написания: 2020'
  });
  assert.equal(o.detectedCategory,'book');
  assert.equal(o.capture.kind,'book');
  assert.equal(o.capture.externalId,'12345678');
  assert.equal(o.capture.authors[0],'Автор Книги');
  assert.equal(o.captureReady,true);
});
test('audiobook identifies audio format',()=>{
  const o=run({url:'https://www.litres.ru/audiobook/author/audio-name-553311/',
    title:'Аудиокнига — Литрес',
    jsonLd:[{'@type':'Audiobook',name:'Аудиокнига',author:{name:'Чтец'},image:'https://cdn.litres.ru/books/audio-cover.jpg'}],
    body:'Длительность 5 ч 30 мин'
  });
  assert.equal(o.detectedCategory,'audiobook');
  assert.equal(o.capture.audioAvailable,true);
  assert.equal(o.capture.audioDurationMinutes,330);
});
test('afisha event with schema.org date and venue',()=>{
  const o=run({url:'https://afisha.yandex.ru/moscow/concert/name-123',
    title:'Концерт — Яндекс Афиша',
    jsonLd:[{'@type':'MusicEvent',name:'Концерт',image:'https://avatars.mds.yandex.net/get-afisha/123.jpg',
      startDate:'2027-04-07T20:00',location:{name:'Клуб',address:{streetAddress:'ул. Тестовая 1',addressLocality:'Москва'}}}],
    body:'Концерт завтра'
  });
  assert.equal(o.detectedCategory,'event');
  assert.equal(o.capture.kind,'event');
  assert.equal(o.capture.startDate,'2027-04-07');
  assert.equal(o.capture.startTime,'20:00');
  assert.equal(o.capture.venueName,'Клуб');
  assert.equal(o.captureReady,true);
});
test('restaurant from maps is place, museum must remain unrecognized',()=>{
  const cafe=run({url:'https://yandex.ru/maps/org/my_cafe/1234/',
    title:'Моё кафе — Яндекс Карты',
    jsonLd:[{'@type':'CafeOrCoffeeShop',name:'Моё кафе',image:'https://example.org/cafe.jpg',address:{streetAddress:'проспект 1',addressLocality:'Москва'}}],
    body:'Кофейня, завтраки'
  });
  assert.equal(cafe.detectedCategory,'place');
  assert.equal(cafe.capture.placeType,'coffee_shop');
  assert.equal(cafe.captureReady,true);
  const museum=run({url:'https://yandex.ru/maps/org/museum/4444/',
    title:'Музей — Яндекс Карты',
    jsonLd:[{'@type':'Museum',name:'Музей'}],body:'Музей с кафе рядом'});
  assert.equal(museum.detectedCategory,'unknown');
  assert.equal(museum.capture,null);
});
test('unknown pages are not fabricated as products',()=>{
  const o=run({url:'https://example.org/about?utm_source=social',title:'Страница о нас',body:'Общая информация'});
  assert.equal(o.detectedCategory,'unknown');
  assert.equal(o.captureReady,false);
  assert.equal(o.capture,null);
});


test('Kassir rejects unrelated JSON-LD events and does not fabricate the excursion',()=>{
  const o=run({
    url:'https://spb.kassir.ru/tourist/ekskursiya-vo-vladimirskij-dvorec',
    title:'Экскурсия во Владимирский дворец — Кассир',
    og:{'og:title':'Экскурсия во Владимирский дворец'},
    jsonLd:[
      {'@type':'Event',name:'Василий Бейнарович, Фауст 21 века',url:'https://spb.kassir.ru/obrazovanie/vasiliy-beynarovich',
        image:'https://spb.kassir.ru/obrazovanie/vasiliy-beynarovich#4053893',
        startDate:'2027-02-20T19:00:00'},
      {'@type':'MusicEvent',name:'Другой концерт',url:'https://spb.kassir.ru/koncert/other',
        image:'https://img.kassir.ru/other.jpg',startDate:'2027-02-20T18:00:00'}
    ],body:'Экскурсия во Владимирский дворец'
  });
  assert.equal(o.detectedCategory,'event');
  assert.equal(o.captureReady,false);
  assert.equal(o.eventMatchSource,'unverified');
  assert.match(o.captureTitle,/Экскурсия во Владимирский дворец/);
  assert.ok(!o.captureTitle.includes('Василий'));
  assert.equal(o.captureImage,'');
  assert.ok(o.missingFields.includes('Нет подтверждения события из разметки страницы'));
});

test('Yandex Afisha supports ChildrensEvent on circus_show URLs',()=>{
  const o=run({
    url:'https://afisha.yandex.ru/saint-petersburg/circus_show/shou-vody-ognia-i-sveta',
    title:'Шоу воды, огня и света! — Яндекс Афиша',
    jsonLd:[{'@type':'ChildrensEvent',name:'Шоу воды, огня и света!',
      image:'https://avatars.mds.yandex.net/get-afishanew/133/poster.jpg',
      startDate:'2027-05-10T18:00:00',location:{name:'Цирк',address:{streetAddress:'Набережная, 1',addressLocality:'Санкт-Петербург'}}}],
    body:'Шоу воды, огня и света!'
  });
  assert.equal(o.detectedCategory,'event');
  assert.equal(o.capture.title,'Шоу воды, огня и света!');
  assert.equal(o.captureReady,true);
  assert.equal(o.capture.activityType,'theatre_show');
});

test('KudaGo long-running exhibition cannot pass with generic city as venue',()=>{
  const o=run({
    url:'https://kudago.com/spb/event/psihologicheskie-vyistavki/',
    title:'Психологические выставки в галерее «Путь»',
    jsonLd:[{'@type':'Event',name:'Психологические выставки в галерее «Путь»',
      image:'https://media.kudago.com/images/event/92/4a/poster.jpg',
      startDate:'2025-10-10T18:00:11Z',endDate:'2026-10-12T21:00:00',
      location:{name:'Санкт-Петербург',address:{streetAddress:'Санкт-Петербург, Россия'}}}],
    body:'Выставка в темноте'
  });
  assert.equal(o.detectedCategory,'event');
  assert.equal(o.captureReady,false);
  assert.ok(o.missingFields.includes('Место проведения'));
  assert.equal(o.capture.city,'Санкт-Петербург');
});

test('Yandex concert with multi-year schedule requires specific session',()=>{
  const o=run({
    url:'https://afisha.yandex.ru/saint-petersburg/concert/sergei-lazarev-shoumen',
    title:'Сергей Лазарев — Шоумен',
    jsonLd:[{'@type':'MusicEvent',name:'Сергей Лазарев',
      image:'https://avatars.mds.yandex.net/get-afishanew/5109582/poster/orig',
      startDate:'2025-10-10T21:00:00.000Z',endDate:'2026-10-10T21:00:00.000Z',
      location:{name:'СКА Арена',address:{streetAddress:'просп. Юрия Гагарина, 8',addressLocality:'Санкт-Петербург'}}}]
  });
  assert.equal(o.detectedCategory,'event');
  assert.equal(o.capture.category,'concert');
  assert.equal(o.captureReady,false);
  assert.ok(o.missingFields.includes('Дата и сеанс требуют уточнения'));
});

test('Ozon bank-only price is not silently treated as universal price',()=>{
  const o=run({
    url:'https://www.ozon.ru/product/shvabra-3424826081/',
    title:'Швабра Smart Mop 2.0',
    jsonLd:[{'@type':'Product',name:'Швабра Smart Mop 2.0',
      image:'https://ir.ozone.ru/s3/multimedia/13543303487.jpg',offers:{price:3170}}],
    body:'В приложении удобнее Похожие 2 853 ₽ С банками Скидка 3 170 ₽'
  });
  assert.equal(o.capturePriceCandidate,'2 853 ₽');
  assert.equal(o.priceWarning,'Цена с условиями оплаты');
  assert.equal(o.captureReady,false);
});

test('Yandex Market price with Pay is flagged and product ID extracted',()=>{
  const o=run({
    url:'https://market.yandex.ru/card/ryukzak/5899703611',
    title:'Рюкзак',
    jsonLd:[{'@type':'Product',name:'Рюкзак коричневый',image:'https://avatars.mds.yandex.net/get-mpic/4614113/picture/orig',offers:{price:1860}}],
    body:'Коричневый 1 860 ₽ Пэй 3 304 ₽ -44%'
  });
  assert.equal(o.externalId,'5899703611');
  assert.equal(o.priceWarning,'Цена с условиями оплаты');
  assert.equal(o.captureReady,false);
});

test('Wildberries skeleton with ellipsis is not a valid title',()=>{
  const o=run({url:'https://www.wildberries.ru/catalog/506134741/detail.aspx',
    title:'...',body:''});
  assert.equal(o.detectedCategory,'product');
  assert.equal(o.captureReady,false);
  assert.ok(o.missingFields.includes('Название'));
  assert.ok(o.missingFields.includes('Изображение'));
});
