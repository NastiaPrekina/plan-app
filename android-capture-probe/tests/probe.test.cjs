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
  assert.equal(o.version,4);
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
  assert.equal(o.capture.startDate,'2027-04-07T20:00');
  assert.equal(o.capture.venue,'Клуб');
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
