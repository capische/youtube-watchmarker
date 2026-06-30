'use strict';

let strLastchange = null;
let objVideodata = {}; // strIdent -> { intTimestamp, strState, intPercent, intCount }
let objCompleted = {}; // strIdent -> true once the active player has crossed the threshold in this session
let objReported = {}; // strIdent -> last whole percent we reported to the background while watching
let objDebugmarked = {}; // de-duplicates watched badge debug output for the same stored decision
let intThreshold = 95; // the percentage of a video that counts as watched, kept in sync with the settings
let boolYouhist = true; // whether videos shown on the youtube history page should be marked as watched
let objObservers = new WeakMap();
let objHovers = new WeakSet();

chrome.storage.local.get(['extensions.Youwatch.Condition.intThreshold', 'extensions.Youwatch.Condition.boolYouhist'], function(objValue) {
    intThreshold = parseInt(objValue['extensions.Youwatch.Condition.intThreshold']) || 95;
    boolYouhist = objValue['extensions.Youwatch.Condition.boolYouhist'] !== String(false);
});

chrome.storage.onChanged.addListener(function(objChanges, strArea) {
    if (strArea !== 'local') {
        return;
    }

    if (objChanges.hasOwnProperty('extensions.Youwatch.Condition.intThreshold') === true) {
        intThreshold = parseInt(objChanges['extensions.Youwatch.Condition.intThreshold'].newValue) || 95;
    }

    if (objChanges.hasOwnProperty('extensions.Youwatch.Condition.boolYouhist') === true) {
        boolYouhist = objChanges['extensions.Youwatch.Condition.boolYouhist'].newValue !== String(false);
    }
});

// ##########################################################

let videos = function(strIdent) {
    return Array.from(window.document.querySelectorAll(([
        'a.ytLockupViewModelContentImage[href^="/watch?v=' + strIdent + '"]', // new - https://github.com/sniklaus/youtube-watchmarker/issues/195
        'a.yt-lockup-view-model__content-image[href^="/watch?v=' + strIdent + '"]', // old
        'a.ytd-thumbnail[href^="/watch?v=' + strIdent + '"]', // list
        'a.reel-item-endpoint[href^="/shorts/' + strIdent + '"]', // shorts
        'a.shortsLockupViewModelHostEndpoint[href*="/shorts/' + strIdent + '"]', // shorts lockup
        'a.ytLockupViewModelContentImage[href^="/shorts/' + strIdent + '"]', // shorts in lockup
        'a.yt-lockup-view-model__content-image[href^="/shorts/' + strIdent + '"]', // shorts in lockup
        'a.ytd-thumbnail[href^="/shorts/' + strIdent + '"]', // shorts in list
        'a.ytp-modern-videowall-still[href*="/watch?v=' + strIdent + '"]', // videowall
        'a.ytp-videowall-still[href*="/watch?v=' + strIdent + '"]', // videowall
        'a.ytp-ce-covering-overlay[href*="/watch?v=' + strIdent + '"]', // overlays
        'a.media-item-thumbnail-container[href*="/watch?v=' + strIdent + '"]', // mobile
        'a.YtmCompactMediaItemImage[href*="/watch?v=' + strIdent + '"]', // mobile
    ]).join(', ')));
};

let funcIdent = function(objVideo) { // the 11 character id sits after /shorts/ for shorts and at the end of the watch url otherwise
    if (objVideo.href.indexOf('/shorts/') !== -1) {
        return objVideo.href.split('/shorts/')[1].slice(0, 11);
    }

    return objVideo.href.split('&')[0].slice(-11);
};

// turns a youtube history section header ("Today", "Yesterday", "Jun 21, 2025", "Saturday, June 21", ...) into a timestamp;
// the watch history only exposes a per-day date, so this resolves to that day (good enough to match what youtube shows)
let funcHistorydate = function(strText) {
    strText = (strText || '').trim();

    if (strText === '') {
        return null;
    }

    let objNow = new Date();
    let strLower = strText.toLowerCase();

    if (strLower === 'today') {
        return objNow.getTime();

    } else if (strLower === 'yesterday') {
        return objNow.getTime() - 86400000;

    }

    let intParsed = Date.parse(strText); // handles absolute dates such as "Jun 21, 2025"

    if (isNaN(intParsed) === true) {
        intParsed = Date.parse(strText + ', ' + objNow.getFullYear()); // headers without a year (current year) eg "Saturday, June 21"

        if ((isNaN(intParsed) === false) && (intParsed > objNow.getTime())) {
            intParsed = Date.parse(strText + ', ' + (objNow.getFullYear() - 1)); // that day has not happened yet this year, so it was last year
        }
    }

    return isNaN(intParsed) === true ? null : intParsed;
};

// reads the date of the history section a given video sits in, if it can be located in the dom
let funcHistorytimestamp = function(objVideo) {
    let objSection = objVideo.closest('ytd-item-section-renderer');

    if (objSection === null) {
        return null;
    }

    let objTitle = objSection.querySelector('#title');

    if (objTitle === null) {
        return null;
    }

    return funcHistorydate(objTitle.innerText || objTitle.textContent || '');
};

let refresh = async function() {
    let objVideos = videos('');

    // the watch-history feed renders inside a browse element that only carries page-subtype="history" once the history
    // content has actually loaded - relying on this (instead of the url alone) avoids a window during navigation where the
    // url is already /feed/history but the previous page's thumbnails (eg the homepage) are still in the dom and would
    // otherwise get marked as watched. each video is additionally checked to actually sit inside that container.
    let objHistory = (window.location.pathname === '/feed/history') ? window.document.querySelector('ytd-browse[page-subtype="history"], [page-subtype="history"]') : null;

    for (let objVideo of objVideos) {
        let strIdent = funcIdent(objVideo);
        let strTitle = '';

        let boolHistory = (objHistory !== null) && (boolYouhist === true) && (objHistory.contains(objVideo) === true);

        mark(objVideo, strIdent);

        observe(objVideo);

        hoverify(objVideo);

        // watched videos never change so they stay cached, but watching videos need a re-lookup to pick up the latest progress
        if ((objVideodata.hasOwnProperty(strIdent) === true) && (objVideodata[strIdent].strState === 'watched')) {
            continue;
        }

        for (let intTitle = 0, objTitle = objVideo.parentNode; intTitle < 5; intTitle += 1, objTitle = objTitle.parentNode) {
            if (objTitle.querySelector('.ytLockupMetadataViewModelTitle') !== null) { // new
                strTitle = objTitle.querySelector('.ytLockupMetadataViewModelTitle').innerText.trim(); break;

            } else if (objTitle.querySelector('.shortsLockupViewModelHostMetadataTitle') !== null) { // shorts
                strTitle = objTitle.querySelector('.shortsLockupViewModelHostMetadataTitle').innerText.trim(); break;

            } else if (objTitle.querySelector('#video-title') !== null) { // old
                strTitle = objTitle.querySelector('#video-title').innerText.trim(); break;

            }
        }

        if ((strTitle === '') && ((objVideo.getAttribute('aria-label') || '') !== '')) {
            strTitle = objVideo.getAttribute('aria-label').trim(); // shorts thumbnails often only expose the title via aria-label
        }

        await chrome.runtime.sendMessage({
            // on the youtube history page we register the video (assumed - watched elsewhere) instead of just looking it up;
            // a sub-threshold resume bar (red line) keeps it watching, otherwise it is assumed watched (shorts carry no bar)
            'strMessage': boolHistory === true ? 'youtubeMark' : 'youtubeLookup',
            'strIdent': strIdent,
            'strTitle': strTitle,
            'strState': 'watching',
            'boolAssumed': true,
            // stamp it with the date youtube lists it under, so the plugin entry matches the watch history instead of "now"
            'intTimestamp': boolHistory === true ? funcHistorytimestamp(objVideo) : null,
        }, function(objResponse) {
            if ((objResponse === null) || (objResponse === undefined)) {
                return;
            }

            objVideodata[objResponse.strIdent] = {
                'intTimestamp': objResponse.intTimestamp,
                'strState': objResponse.strState || 'watched',
                'intPercent': objResponse.intPercent || 0,
                'intCount': objResponse.intCount || 0,
                'strDebugSource': objResponse.strDebugSource || '',
                'strDebugReason': objResponse.strDebugReason || '',
                'intDebugTimestamp': objResponse.intDebugTimestamp || 0,
            };

            for (let objVideo of videos(objResponse.strIdent)) {
                mark(objVideo, objResponse.strIdent);
            }
        });
    }
    
    strLastchange = window.location.href + ':' + window.document.title + ':' + objVideos.length;
};

let funcUnmark = function(objVideo) {
    if (objVideo.classList.contains('youwatch-mark') === true) {
        objVideo.classList.remove('youwatch-mark');
        objVideo.classList.remove('youwatch-watched');
        objVideo.classList.remove('youwatch-watching');

        if (objVideo.hasAttribute('watchdate') === true) {
            objVideo.removeAttribute('watchdate');
        }

        if (objVideo.hasAttribute('watchcount') === true) {
            objVideo.removeAttribute('watchcount');
        }

        if (objVideo.hasAttribute('watchpercent') === true) {
            objVideo.removeAttribute('watchpercent');
        }

        objVideo.style.removeProperty('--youwatch-percent');
    }
};

let mark = function(objVideo, strIdent) {
    if (objVideodata.hasOwnProperty(strIdent) === true) {
        // a shorts video can match two elements (a thumbnail link and a separate title link) - only the one that
        // actually carries the thumbnail image gets marked, so the badge does not end up duplicated over the title
        if (objVideo.querySelector('img, .ytp-videowall-still-image') === null) {
            for (let objSibling of videos(strIdent)) {
                if ((objSibling !== objVideo) && (objSibling.querySelector('img, .ytp-videowall-still-image') !== null)) {
                    funcUnmark(objVideo);
                    return;
                }
            }
        }

        let objData = objVideodata[strIdent];
        let boolWatched = objData.strState === 'watched';

        if (boolWatched === true) {
            let strDebugkey = strIdent + ':' + (objData.intDebugTimestamp || 0) + ':' + (objData.strDebugSource || '') + ':' + (objData.strDebugReason || '');

            if (objDebugmarked[strDebugkey] !== true) {
                objDebugmarked[strDebugkey] = true;

                console.debug('[YWM mark] watched badge', {
                    'strIdent': strIdent,
                    'strSource': objData.strDebugSource || 'stored-lookup',
                    'strReason': objData.strDebugReason || 'stored state is watched',
                    'intDebugTimestamp': objData.intDebugTimestamp || 0,
                    'intTimestamp': objData.intTimestamp || 0,
                    'intPercent': objData.intPercent || 0,
                    'intCount': objData.intCount || 0,
                    'strUrl': objVideo.href || '',
                });
            }
        }

        objVideo.classList.add('youwatch-mark');
        objVideo.classList.toggle('youwatch-watched', boolWatched);
        objVideo.classList.toggle('youwatch-watching', boolWatched === false);

        if ((objData.intTimestamp !== undefined) && (objData.intTimestamp !== null) && (objData.intTimestamp !== 0)) {
            objVideo.setAttribute('watchdate', ' - ' + new Date(objData.intTimestamp).toISOString().split('T')[0].split('-').join('.'));
        }

        objVideo.setAttribute('watchcount', objData.intCount || 0);

        if ((boolWatched === false) && (objData.intPercent > 0)) {
            objVideo.setAttribute('watchpercent', objData.intPercent); // drives the "WATCHING NN%" badge for in-progress videos
            objVideo.style.setProperty('--youwatch-percent', objData.intPercent + '%'); // drives the width of the progress bar
        } else {
            if (objVideo.hasAttribute('watchpercent') === true) {
                objVideo.removeAttribute('watchpercent');
            }

            objVideo.style.removeProperty('--youwatch-percent');
        }

    } else {
        funcUnmark(objVideo);
    }
};

let observe = function(objVideo) {
    if (objObservers.has(objVideo) === true) {
        return;
    }

    let objObserver = new MutationObserver(function() {
        mark(objVideo, funcIdent(objVideo));
    });

    objObserver.observe(objVideo, { 'attributes': true, 'attributeFilter': ['href'] });

    objObservers.set(objVideo, objObserver);
};

// hovering over the thumbnail alone only covers a small area, so the fadeout/grayout is also lifted while hovering
// over the wider card (thumbnail + title) that triggers Youtube's own preview-on-hover behaviour
let hoverify = function(objVideo) {
    if (objHovers.has(objVideo) === true) {
        return;
    }

    objHovers.add(objVideo);

    let objCard = null;

    for (let intLevel = 0, objAncestor = objVideo.parentNode; intLevel < 5; intLevel += 1, objAncestor = objAncestor.parentNode) {
        if ((objAncestor === null) || (objAncestor === undefined) || (objAncestor === window.document.body)) {
            break;
        }

        if ((objAncestor.querySelector('.ytLockupMetadataViewModelTitle') !== null) ||
            (objAncestor.querySelector('.shortsLockupViewModelHostMetadataTitle') !== null) ||
            (objAncestor.querySelector('#video-title') !== null)) {
            objCard = objAncestor; break;

        }
    }

    if (objCard === null) {
        return; // no wider card found, the thumbnail's own :hover already covers this case
    }

    objCard.addEventListener('mouseenter', function() {
        objVideo.classList.add('youwatch-hover');
    });

    objCard.addEventListener('mouseleave', function() {
        objVideo.classList.remove('youwatch-hover');
    });
};

// ##########################################################

document.addEventListener('youtubeProgress', async function(objEvent) {
    await chrome.runtime.sendMessage({
        'strMessage': 'youtubeProgress',
        'strIdent': objEvent.detail['strIdent'],
        'strTitle': objEvent.detail['strTitle'],
        'intPercent': objEvent.detail['intPercent'],
        'boolEnsure': true,
    }, function(objResponse) {
        // ...
    });

    if (false) {
        window.setTimeout(function() {
            for (let objElement of document.querySelectorAll('span, a, yt-formatted-string')) {
                if (objElement.textContent.includes(objEvent.detail['strTitle']) === true) {
                    objElement.textContent = 'HOOK';
                }
            }
        }, 3000);
    }
});

// ##########################################################

chrome.runtime.onMessage.addListener(async function(objData, objSender, funcResponse) {
    if (objData.strMessage === 'youtubeRefresh') {
        await refresh();

    } else if (objData.strMessage === 'youtubeMark') {
        let objPrev = objVideodata.hasOwnProperty(objData.strIdent) === true ? objVideodata[objData.strIdent] : {};

        objVideodata[objData.strIdent] = {
            'intTimestamp': objData.intTimestamp || objPrev.intTimestamp || 0,
            'strState': objData.strState || objPrev.strState || 'watched',
            'intPercent': (objData.intPercent !== undefined) && (objData.intPercent !== null) ? objData.intPercent : (objPrev.intPercent || 0),
            'intCount': (objData.intCount !== undefined) && (objData.intCount !== null) ? objData.intCount : (objPrev.intCount || 0),
        };

        for (let objVideo of videos(objData.strIdent)) {
            mark(objVideo, objData.strIdent);
            hoverify(objVideo);
        }

    }

    funcResponse(null);
});

// ##########################################################

let funcActiveident = function() { // the id of the video the player is currently on, if any
    if (window.location.pathname === '/watch') {
        return new URLSearchParams(window.location.search).get('v');

    } else if (window.location.pathname.indexOf('/shorts/') === 0) {
        return window.location.pathname.split('/shorts/')[1].slice(0, 11);

    }

    return null;
};

let funcActivetitle = function() {
    let strTitle = window.document.title;

    if (strTitle.slice(-10) === ' - YouTube') {
        strTitle = strTitle.slice(0, -10);
    }

    return strTitle.trim();
};

let funcVideoel = function() { // youtube can have several <video> elements, so pick the actual player
    let objMain = window.document.querySelector('video.html5-main-video') || window.document.querySelector('.html5-video-player video');

    if ((objMain !== null) && (objMain.duration) && (isNaN(objMain.duration) === false) && (objMain.duration > 0)) {
        return objMain;
    }

    let objBest = null;

    for (let objVideoel of window.document.querySelectorAll('video')) {
        if ((objVideoel.duration) && (isNaN(objVideoel.duration) === false) && (objVideoel.duration > 0)) {
            if ((objBest === null) || (objVideoel.duration > objBest.duration)) {
                objBest = objVideoel;
            }
        }
    }

    return objBest;
};

let funcProgress = function() { // promote the active video to watched once the player crosses the threshold
    let strIdent = funcActiveident();

    if ((strIdent === null) || (strIdent.length !== 11)) {
        return;
    }

    let objVideoel = funcVideoel();

    if (objVideoel === null) {
        return;
    }

    let intPercent = Math.round((objVideoel.currentTime / objVideoel.duration) * 100);

    if ((intPercent >= intThreshold) && (objCompleted[strIdent] !== true)) {
        objCompleted[strIdent] = true;

        chrome.runtime.sendMessage({
            'strMessage': 'youtubeComplete',
            'strIdent': strIdent,
            'strTitle': funcActivetitle(),
        }, function(objResponse) {
            // ...
        });

    } else if ((intPercent < intThreshold) && (objCompleted[strIdent] !== true) && (objReported[strIdent] !== intPercent)) {
        let boolResume = (objReported[strIdent] === undefined); // the first reading after opening reflects the resume position

        objReported[strIdent] = intPercent; // report live progress, but only on a whole-percent change to limit writes

        chrome.runtime.sendMessage({
            'strMessage': 'youtubeWatching',
            'strIdent': strIdent,
            'strTitle': funcActivetitle(),
            'intPercent': intPercent,
            'boolResume': boolResume,
        }, function(objResponse) {
            // ...
        });

    }
};

window.setInterval(funcProgress, 1000);

// ##########################################################

document.addEventListener('visibilitychange', async function() {
    if (document.visibilityState === 'visible') {
        await refresh();
    }
});

// ##########################################################

let eventhandler = function() {
    objCompleted = {}; // a navigation starts a fresh watch, so a re-watch of the same video counts again (and shorts loops do not)
    objReported = {};

    for (let delay = 0; delay < 3000 + 1; delay += 300) {
        window.setTimeout(refresh, delay); // refreshing right away might have been too early so instead we do it brute force
    }
};

document.addEventListener('yt-service-request-completed', eventhandler); // https://github.com/sota2501/youtube-chat-ex/blob/master/docs/event.md
document.addEventListener('yt-navigate-finish', eventhandler); // https://github.com/sota2501/youtube-chat-ex/blob/master/docs/event.md
document.addEventListener('yt-page-type-changed', eventhandler); // https://github.com/sota2501/youtube-chat-ex/blob/master/docs/event.md
document.addEventListener('yt-page-data-updated', eventhandler); // https://github.com/sota2501/youtube-chat-ex/blob/master/docs/event.md
document.addEventListener('yt-visibility-refresh', eventhandler); // https://github.com/1natsu172/Outside-YouTube-Player-Bar/blob/develop/src/core/services/eventEffectServices/libs/YT_EVENTS.ts

// ##########################################################

window.setInterval(async function() {
    if (document.hidden === true) {
        return;

    } else if (strLastchange === window.location.href + ':' + window.document.title + ':' + videos('').length) {
        return;

    }

    await refresh();
}, 300);
