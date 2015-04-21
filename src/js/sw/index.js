require('serviceworker-cache-polyfill');

var version = 'v27';
var staticCacheName = 'danbo-static-v27';
var expectedCaches = [
    staticCacheName,
    'danbo-imgs',
    'danbo-data'
];

self.addEventListener('install', function(event) {
    self.skipWaiting();""

    event.waitUntil(
        caches.open(staticCacheName).then(function(cache) {
            return cache.addAll([
                './',
                'css/all.css',
                'js/page.js',
                'imgs/logo.svg',
                'imgs/icon.png',
            ]);
        })
    );
});

self.addEventListener('activate', function(event) {
    if (self.clients && clients.claim) {
        clients.claim();
    }

    // remove caches beginning "danbo-" that aren't in
    // expectedCaches
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    if (/^danbo-/.test(cacheName) && expectedCaches.indexOf(cacheName) == -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', function(event) {
    var requestURL = new URL(event.request.url);

    if (requestURL.hostname == 'api.flickr.com') {
        console.log("flikr data request");
        event.respondWith(flickrAPIResponse(event.request));
    }
    else if (/\.staticflickr\.com$/.test(requestURL.hostname)) {
        console.log("flickr image request");
        event.respondWith(flickrImageResponse(event.request));
    }
    else {
        console.log("other request for: ", requestURL.pathname);
        event.respondWith(
            caches
                // try and serve the request from the static cache
                .match(event.request {
                    cacheName: staticCacheName
                })
                // if it isn't in the static cache, just let the request go through
                .catch(function(){
                    return event.request
                })
        );

        // Try to update the static cache so that next time the response will be cached
        updateStaticCacheForNextTime(event.request);
    }
});

function getPhotoURL(photo) {
    return 'https://farm' + photo.farm + '.staticflickr.com/' + photo.server + '/' + photo.id + '_' + photo.secret + '_c.jpg';
}

function updateStaticCacheForNextTime(request) {
    var cacheUpdateRequest = request.clone();
    caches.match(cacheUpdateRequest, {
            cacheName: staticCacheName
        })
        .then(function(cacheHit) {
            if (cacheHit) {
                caches.open(staticCacheName).then(function(cache) {
                    fetch(cacheUpdateRequest).then(function (response) {
                        cache.put(cacheUpdateRequest.url, response);
                        console.log("updating cache for", cacheUpdateRequest.url);
                    });
                });
            }
        });
}

function flickrAPIResponse(request) {
    if (request.headers.get('x-use-cache-only')) {
        return caches.match(request);
    } else if (request.headers.get('x-cache-warmup')) {
        var headers = new Headers(request.headers);
        headers.delete('x-cache-warmup');
        return flickrAPIResponse(new Request(request, {headers: headers})).then(function(response) {
            return response.json();
        }).then(function(data) {
            var imgRequests = data.photos.photo.map(getPhotoURL).map(function(url) {
                return new Request(url, {mode: 'no-cors'});
            });
            return Promise.all(imgRequests.map(flickrImageResponse));
        }).then(function() {
            return caches.match(request);
        });
    } else {
        return fetch(request).then(function(response) {
            return caches.open('danbo-data').then(function(cache) {
                // clean up the image cache
                Promise.all([
                    response.clone().json(),
                    caches.open('danbo-imgs')
                ]).then(function(results) {
                    var data = results[0];
                    var imgCache = results[1];

                    var imgURLs = data.photos.photo.map(getPhotoURL);

                    // if an item in the cache *isn't* in imgURLs, delete it
                    imgCache.keys().then(function(requests) {
                        requests.forEach(function(request) {
                            if (imgURLs.indexOf(request.url) == -1) {
                                imgCache.delete(request);
                            }
                        });
                    });
                });

                cache.put(request, response.clone());

                return response;
            });
        });
    }
}

function flickrImageResponse(request) {
    return caches.match(request).then(function(response) {
        if (response) {
            return response;
        }

        return fetch(request).then(function(response) {
            caches.open('danbo-imgs').then(function(cache) {
                cache.put(request, response);
            });

            return response.clone();
        });
    });
}
