'use strict';

// ##########################################################

// funcHackyparse, funcParsevideos and funcPercent live in the shared parse.js, loaded before this file by the
// MAIN-world content_scripts entry, so the page-world parsing here stays identical to the service worker's.

let funcEmitvideos = function(strText) {
    for (let objVideo of funcParsevideos(strText, true)) {
        document.dispatchEvent(new CustomEvent('youtubeProgress', {
            'detail': {
                'strIdent': objVideo['strIdent'],
                'strTitle': objVideo['strTitle'],
                'intPercent': funcPercent(objVideo['objVideo']),
            },
        }));
    }
};

// ##########################################################

window.addEventListener('DOMContentLoaded', function() {
    funcEmitvideos(document.documentElement.outerHTML.split('var ytInitialData = ').slice(-1)[0].split(';</script>')[0]);
});

// ##########################################################

// youtube stores the resume position (the red bar on thumbnails and in the history) from periodic
// api/stats/watchtime beacons, but the last heartbeat usually lands a few seconds before the end, leaving a fully
// watched video stuck at 9x% - so the newest beacon url is remembered per video and replayed with the playhead
// pinned to the full duration once the player fires 'ended', making youtube record it as watched to 100%
let objWatchtimeurl = {};
let objWatchtimedone = {};
let objWatchtimecpn = {};

let funcWatchtimecapture = function(strUrl) {
    if ((typeof strUrl !== 'string') || (strUrl.indexOf('/api/stats/watchtime') === -1)) {
        return;
    }

    try {
        let objUrl = new URL(strUrl, window.location.origin);
        let strDocid = objUrl.searchParams.get('docid');

        if (strDocid !== null) {
            let strCpn = objUrl.searchParams.get('cpn');

            objWatchtimeurl[strDocid] = objUrl.toString();

            if (strCpn !== objWatchtimecpn[strDocid]) {
                objWatchtimecpn[strDocid] = strCpn; // a new client playback nonce means a fresh playback session, so
                objWatchtimedone[strDocid] = false; // allow another finalize - later beacons of the same session do not re-arm it
            }

            console.debug('[YWM wt] captured beacon', {
                'strDocid': strDocid,
                'strCmt': objUrl.searchParams.get('cmt'),
                'strHost': objUrl.host,
            });
        }

    } catch (objError) {
        // ...
    }
};

let funcWatchtimefinalize = function(objVideoel, strTrigger) {
    let objPlayer = window.document.getElementById('movie_player');

    if ((objPlayer === null) || (typeof objPlayer.getVideoData !== 'function')) {
        console.debug('[YWM wt] finalize skipped - no player api', { 'strTrigger': strTrigger });
        return;
    }

    let strDocid = null;

    try {
        strDocid = (objPlayer.getVideoData() || {}).video_id || null;

    } catch (objError) {
        return;
    }

    let fltDuration = objVideoel.duration;

    if ((strDocid === null) || (objWatchtimedone[strDocid] === true) || (isFinite(fltDuration) !== true) || (fltDuration <= 0.0)) {
        return;
    }

    if (objWatchtimeurl[strDocid] === undefined) {
        console.debug('[YWM wt] finalize skipped - no beacon captured for this video', {
            'strDocid': strDocid,
            'strTrigger': strTrigger,
            'objCaptured': Object.keys(objWatchtimeurl),
        });
        return;
    }

    objWatchtimedone[strDocid] = true;

    let objUrl = new URL(objWatchtimeurl[strDocid]);
    let strEnd = Math.max(0.0, fltDuration - 0.1).toFixed(3);

    objUrl.searchParams.set('st', Math.max(0.0, fltDuration - 0.6).toFixed(3)); // a short real interval at the very
    objUrl.searchParams.set('et', strEnd); // end - zero-length segments risk being discarded by the stats endpoint
    objUrl.searchParams.set('cmt', strEnd);
    objUrl.searchParams.set('final', '1');

    console.debug('[YWM wt] finalizing', {
        'strDocid': strDocid,
        'strTrigger': strTrigger,
        'strCmt': strEnd,
    });

    objFetch(objUrl.toString(), {
        'credentials': 'include',
    }).then(function(objResponse) {
        console.debug('[YWM wt] finalize response', {
            'strDocid': strDocid,
            'intStatus': objResponse.status,
        });

    }).catch(function(objError) {
        console.debug('[YWM wt] finalize failed', {
            'strDocid': strDocid,
            'strError': String(objError),
        });
    });
};

let funcWatchtimeevent = function(objEvent) {
    if (((objEvent.target instanceof HTMLVideoElement) !== true) || (objEvent.target.closest('#movie_player') === null)) {
        return; // only the main player counts - inline previews and thumbnail hovers end too
    }

    if ((objEvent.type === 'timeupdate') && ((isFinite(objEvent.target.duration) !== true) || (objEvent.target.currentTime < (objEvent.target.duration - 1.0)))) {
        return; // the timeupdate path only acts within the last second, as a fallback for players that never fire 'ended'
    }

    funcWatchtimefinalize(objEvent.target, objEvent.type);
};

// neither media event bubbles, but a capturing listener on the document still sees them
document.addEventListener('ended', funcWatchtimeevent, true);
document.addEventListener('timeupdate', funcWatchtimeevent, true);

// ##########################################################

let objXhr = window.XMLHttpRequest.prototype.open;
let objFetch = window.fetch;
let objBeacon = window.navigator.sendBeacon;

window.XMLHttpRequest.prototype.open = function() {
    funcWatchtimecapture(arguments[1]);

    this.addEventListener('load', function() {
        if (this.responseURL.indexOf('.youtube.com/youtubei/v1/') !== -1) {
            funcEmitvideos(this.responseText);
        }
    });

    return objXhr.apply(this, arguments);
};

if (typeof objBeacon === 'function') {
    window.navigator.sendBeacon = function() {
        funcWatchtimecapture(arguments[0]);

        return objBeacon.apply(window.navigator, arguments);
    };
}

window.fetch = async function(objRequest, objOptions) {
    let objResponse = await objFetch(objRequest, objOptions);

    let strUrl = (typeof objRequest === 'string') ? objRequest : ((objRequest instanceof Request) ? objRequest.url : String(objRequest));

    funcWatchtimecapture(strUrl);

    if (strUrl.indexOf('.youtube.com/youtubei/v1/') !== -1) {
        // read a clone off to the side instead of buffering the whole body before the page gets it - the original
        // response is returned straight away so youtube's own navigation is not held up while we scan for videos
        objResponse.clone().text().then(function(strResponse) {
            funcEmitvideos(strResponse);
        }).catch(function() {
            // ...
        });
    }

    return objResponse;
};
