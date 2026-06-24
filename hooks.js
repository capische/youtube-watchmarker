'use strict';

// ##########################################################

let funcHackyparse = function(strJson) {
    let intLength = 1;

    for (let intCount = 0; intLength < strJson.length; intLength += 1) {
        if (strJson[intLength - 1] === '{') {
            intCount += 1;

        } else if (strJson[intLength - 1] === '}') {
            intCount -= 1;

        }

        if (intCount === 0) {
            break;
        }
    }

    try {
        return JSON.parse(strJson.substr(0, intLength));
    } catch (objError) {
        // ...
    }

    return null;
};

let funcParsevideos = function(strText, boolProgress) {
    let objVideos = [];

    if (strText.indexOf('\\x22responseContext\\x22') !== -1) {
        strText = strText.replace(new RegExp('\\\\x([0-9a-f][0-9a-f])', 'g'), function(objMatch) {
            return String.fromCharCode(parseInt(objMatch.substr(2), 16));
        });
    }

    for (let strVideo of strText.split('{"lockupViewModel":').slice(1)) {
        let objVideo = funcHackyparse('{"lockupViewModel":' + strVideo);

        if (objVideo === null) {
            continue;
        }

        if (boolProgress === true) {
            if (JSON.stringify(objVideo).indexOf('"thumbnailOverlayProgressBarViewModel"') === -1) {
                continue;
            }
        }

        let strIdent = objVideo['lockupViewModel']['contentId'];
        let strTitle = null;

        if (strTitle === null) {
            try {
                strTitle = objVideo['lockupViewModel']['metadata']['lockupMetadataViewModel']['title']['content'];
            } catch (objError) {
                // ...
            }
        }

        if (strTitle === null) {
            try {
                strTitle = objVideo['lockupViewModel']['rendererContext']['accessibilityContext']['label'];
            } catch (objError) {
                // ...
            }
        }

        if (strIdent.length !== 11) {
            continue;

        } else if (strTitle === null) {
            continue;

        }

        objVideos.push({
            'objVideo': objVideo,
            'strIdent': strIdent,
            'strTitle': strTitle,
        })
    }

    for (let strVideo of strText.split('{"videoWithContextRenderer":').slice(1)) {
        let objVideo = funcHackyparse('{"videoWithContextRenderer":' + strVideo);

        if (objVideo === null) {
            continue;
        }

        if (boolProgress === true) {
            if (JSON.stringify(objVideo).indexOf('"startTimeSeconds"') === -1) {
                continue;
            }
        }

        let strIdent = objVideo['videoWithContextRenderer']['videoId'];
        let strTitle = null;

        if (strTitle === null) {
            try {
                strTitle = objVideo['videoWithContextRenderer']['headline']['runs'][0]['text'];
            } catch (objError) {
                // ...
            }
        }

        if (strTitle === null) {
            try {
                strTitle = objVideo['videoWithContextRenderer']['headline']['accessibility']['accessibilityData']['label'];
            } catch (objError) {
                // ...
            }
        }

        if (strIdent.length !== 11) {
            continue;

        } else if (strTitle === null) {
            continue;

        }

        objVideos.push({
            'objVideo': objVideo,
            'strIdent': strIdent,
            'strTitle': strTitle,
        })
    }

    for (let strVideo of strText.split('{"videoRenderer":{"videoId":"').slice(1)) {
        let objVideo = funcHackyparse('{"videoRenderer":{"videoId":"' + strVideo);

        if (objVideo === null) {
            continue;
        }

        if (boolProgress === true) {
            if (JSON.stringify(objVideo).indexOf('"percentDurationWatched"') === -1) {
                continue;
            }
        }

        let strIdent = objVideo['videoRenderer']['videoId'];
        let strTitle = objVideo['videoRenderer']['title']['runs'][0]['text'];

        if (strIdent.length !== 11) {
            continue;
        }

        objVideos.push({
            'objVideo': objVideo,
            'strIdent': strIdent,
            'strTitle': strTitle,
        })
    }

    for (let strVideo of strText.split('{"compactVideoRenderer":{"videoId":"').slice(1)) {
        let objVideo = funcHackyparse('{"compactVideoRenderer":{"videoId":"' + strVideo);

        if (objVideo === null) {
            continue;
        }

        if (boolProgress === true) {
            if (JSON.stringify(objVideo).indexOf('"percentDurationWatched"') === -1) {
                continue;
            }
        }

        let strIdent = objVideo['compactVideoRenderer']['videoId'];
        let strTitle = objVideo['compactVideoRenderer']['title']['runs'][0]['text'];

        if (strIdent.length !== 11) {
            continue;
        }

        objVideos.push({
            'objVideo': objVideo,
            'strIdent': strIdent,
            'strTitle': strTitle,
        })
    }

    for (let strVideo of strText.split('{"playlistVideoRenderer":{"videoId":"').slice(1)) {
        let objVideo = funcHackyparse('{"playlistVideoRenderer":{"videoId":"' + strVideo);

        if (objVideo === null) {
            continue;
        }

        if (boolProgress === true) {
            if (JSON.stringify(objVideo).indexOf('"percentDurationWatched"') === -1) {
                continue;
            }
        }

        let strIdent = objVideo['playlistVideoRenderer']['videoId'];
        let strTitle = objVideo['playlistVideoRenderer']['title']['runs'][0]['text'];

        if (strIdent.length !== 11) {
            continue;
        }

        objVideos.push({
            'objVideo': objVideo,
            'strIdent': strIdent,
            'strTitle': strTitle,
        })
    }

    return objVideos;
};

let funcPercent = function(objVideo) { // the resume progress bar (red line) reports how much of the video has been watched
    let strJson = JSON.stringify(objVideo);
    let objMatch = null;

    if ((objMatch = strJson.match(/"percentDurationWatched":\s*(\d+)/)) !== null) {
        return parseInt(objMatch[1]); // videoRenderer / compactVideoRenderer / playlistVideoRenderer carry it directly
    }

    if ((objMatch = strJson.match(/"thumbnailOverlayProgressBarViewModel":\s*\{([^{}]*)\}/)) !== null) {
        let intPercent = null; // the newer lockupViewModel exposes the watched extent through the resume bar view model

        for (let objIter of objMatch[1].matchAll(/"(?:start|end)Percent":\s*(\d+)/g)) {
            intPercent = Math.max(intPercent === null ? 0 : intPercent, parseInt(objIter[1])); // the watched bar reaches its furthest edge
        }

        return intPercent;
    }

    return null;
};

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

let objXhr = window.XMLHttpRequest.prototype.open;
let objFetch = window.fetch;

window.XMLHttpRequest.prototype.open = function() {
    this.addEventListener('load', function() {
        if (this.responseURL.indexOf('.youtube.com/youtubei/v1/') !== -1) {
            funcEmitvideos(this.responseText);
        }
    });

    return objXhr.apply(this, arguments);
};

window.fetch = async function(objRequest, objOptions) {
    let objResponse = await objFetch(objRequest, objOptions);

    if ((typeof(objRequest) === 'string' ? objRequest : objRequest.url).indexOf('.youtube.com/youtubei/v1/') !== -1) {
        let strResponse = await objResponse.text();

        funcEmitvideos(strResponse);

        objResponse = new Response(strResponse, {
            'status': objResponse.status,
            'statusText': objResponse.statusText,
            'headers': objResponse.headers,
        });
    }

    return objResponse;
};
