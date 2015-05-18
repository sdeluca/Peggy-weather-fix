var request = require('request');
var http = require('http');
var xml_digester = require('xml-digester');
var digester = xml_digester.XmlDigester({});
require('date-format-lite');

var options = {
    host: 'localhost',
    port: 8080,
    agent: false
};

var wtypes = {
    NONE: 0,
    SUNNY: 1,
    SNOWY: 2,
    RAINY: 3,
    CLOUDY: 4
};
var COLORS = [
    "{g}",
    "{o}",
    "{r}"
];
var wterms = {
    "rain": wtypes.RAINY,
    "hail": wtypes.RAINY,
    "snow": wtypes.SNOWY,
    "sleet": wtypes.SNOWY,
    "overcast": wtypes.CLOUDY,
    "cloud": wtypes.CLOUDY
};
var weather_clear = false,
    weather_type = wtypes.NONE;

var board = { id: 5, 'cols': 32, 'rows': 12, 'right': -1, 'below': -1 };

var pix = [];
var pcolor = [];
var x;
var firstRow = 1;
var sunBlink = 1;

var PADDING = '                    ';

function simpleLogError(e) {
    e = e || {};
    console.log('Got error: ' + e.message);
}

function getWeather() {

    var formattedDate = 'Unknown';
    try {
        formattedDate = new Date().format('DDDD, MMMM D H:mm A');
    } catch (e) {
        console.log('Unable to format date: ' + e);
    }

    options.path = '/peggy/write?board=4&x=1&y=0&text=' + encodeURIComponent(formattedDate + PADDING);
    http.get(options).on('error', simpleLogError);

    request('http://w1.weather.gov/xml/current_obs/KMSP.xml', function (err, resp, body) {

        if (err) {
            console.log('Failed request to get weather: ' + err);
            return;
        }

        digester.digest(body, function (err, result) {

            if (err) {
                console.log('Failed to parse XML: ' + err);
                return;
            }

            result = result || {};
            var observation = result.current_observation || {};
            var weather = observation.weather || {};
            var temperature = observation.temperature_string || '';
            var wind = observation.wind_string || '';

            // update the weather type

            var wt = wtypes.SUNNY, wlc = weather.toLowerCase();
            for (var w in wterms) {
                if (wlc.indexOf(w) >= 0) {
                    wt = wterms[w];
                    break;
                }
            }
            if (wt != weather_type) weather_clear = true;
            weather_type = wt;

            // update the board

            options.path = '/peggy/write?board=4&x=3&y=1&text=' + encodeURIComponent(weather + PADDING);
            http.get(options).on('error', simpleLogError);

            options.path = '/peggy/write?board=4&x=3&y=2&text=' + encodeURIComponent('Temperature: ' + temperature + PADDING);
            http.get(options).on('error', simpleLogError);

            options.path = '/peggy/write?board=4&x=3&y=3&text=' + encodeURIComponent('Wind: ' + wind + PADDING);
            http.get(options).on('error', simpleLogError);
        });
    });
}

function drawWeather() {
    if (weather_clear) {
        weather_clear = false;
        clearLines(1);
    }

    switch (weather_type) {
        case wtypes.NONE:
            return;
        case wtypes.CLOUDY:
        case wtypes.SUNNY:
            sunAndClouds();
            break;
        case wtypes.RAINY:
        case wtypes.SNOWY:
            snowAndRain();
            break;
    }
}

function sunAndClouds() {
    // get sun position
    var d = new Date(),
        h = d.getHours() + (d.getMinutes() / 60);
    // TODO: get actual sunrise & sunset times (weather module's KMSP.xml feed doesn't contain this, but this seems valid: http://www.srh.noaa.gov/data/MPX/CLIMSP)

    var sunWidth = 10,
        sunrise = 7,
        sunset = 19,
        pos = changeRange(sunrise, sunset, h, 0-(sunWidth/2), board.cols-(sunWidth/2), true, false);
    
    var pad = (pos > 0) ? repeatString(" ", pos) : "";

    // console.log("Hours = " + h + ", Pos = " + pos);

    function moveWriteCell(x, y, color, line) {
        if (pos < 0) line = line.substr(pos * -1);
        var msg = pad + color + line;
        writeCell(x, y, msg);
    }

    if (sunBlink <= 1) {
        // only redraw when the sun is blinking on or off

        // super simple sun
        var b7 = repeatString(String.fromCharCode(127), 7);
        var b5 = repeatString(String.fromCharCode(127), 5);
        var b3 = repeatString(String.fromCharCode(127), 3);
        var writeLines, writeColor;

        if (weather_type == wtypes.CLOUDY) {
            writeColor = '{g}';
            writeLines = [
                " ,----------,   ",
                "(            )  ",
                " (   (  )     ) ",
                "  (         )   ",
                "   `-------`    "
            ];
        } else if (sunBlink == 0) {
            writeColor = '{o}';
            writeLines = [
                "  " + b7 + "  ",
                "- " + b7 + " -",
                "    "+b3+"    ",
                "     .      "
            ];
        } else if (sunBlink == 1) {
            writeColor = '{o}';
            writeLines = [
                "  " + b7 + "  ",
                "  " + b7 + "  ",
                "    "+b3+"    ",
                "            "
            ];
        }

        for (var i=0, imax=writeLines.length; i<imax; i++) {
            moveWriteCell(0, i+1, writeColor, writeLines[i]);
        }
    }

    sunBlink++;
    if (sunBlink >= 5) sunBlink = 0;
}

function snowAndRain() {
    var clear = [];
    // move all current pix down by 1
    for (x=0; x<board.cols; x++) {
        if (pix[x] >= 0) {
            pix[x]++;
            if (pix[x] >= board.rows) {
                pix[x] = -1;
                clear[x] = true;
            }
        }
    }

    // should we add a new pix?
    if (Math.random() < 0.9) {
        // find an open spot
        var col = getOpenCol();
        if (col >= 0) {
            // console.log("Adding a new pixel at " + col);
            pix[col] = firstRow;
            pcolor[col] = getRandColor();
        }
    }

    // rain or snow?
    var cChar = (weather_type == wtypes.RAINY) ? '!' : '*';
    var bRain = (weather_type == wtypes.RAINY);

    // draw all relevant rows
    for (var y=firstRow; y<board.rows; y++) {
        if (pix.indexOf(y) || pix.indexOf(y-1)) {
            // we have SOMETHING to write here - pixel or space
            var line = "", write = false;
            for (x=0; x<board.cols; x++) {
                if (bRain && pix[x] == y+2) {
                    line += " ";
                    write = true;
                    //writeCell(x, y, " ");
                } else if (pix[x] == y+1) {
                    line += (bRain) ? pcolor[x] + cChar : " ";
                    write = true;
                } else if (pix[x] == y) {
                    line += pcolor[x] + cChar;
                    write = true;
                    //writeCell(x, y, pcolor[x] + ".");
                } else if (y == board.rows - 1 && clear[x]) {
                    line += " ";
                    write = true;
                    //writeCell(x, y, " ");
                    clear[x] = false;
                } else {
                    line += " ";
                }
            }
            if (write) {
                // console.log("Write line " + y + ": \"" + line + "\"");
                options.path = "/peggy/write?board=" + board.id + "&x=0&y=" + y + "&text=" + encodeURIComponent(line);
                http.get(options).on('error', simpleLogError);
            }
        }
    }
    // console.log("-");
    // 
    //options.path = "/peggy/write?board=" + board.id + "&x=0&y=0&text=" + getRandColor() + "********************************";
    //http.get(options);
}

function initDrawWeather() {
    // initialize the drawing cols
    for (x=0; x<board.cols; x++) {
        pix[x] = -1;
        pcolor[x] = "";
    }
    // clear the drawing board
    options.path = '/peggy/write?board=' + board.id + '&x=0&y=0&text=' + encodeURIComponent('{g}' + repeatString('*', board.cols));
    http.get(options).on('error', simpleLogError);
    clearLines(1);
}

function repeatString(str, num) {
    return new Array( num + 1 ).join( str );
}

function writeCell(x, y, msg) {
    options.path = "/peggy/write?board=" + board.id + "&x=" + x + "&y=" + y + "&text=" + encodeURIComponent(msg);
    http.get(options).on('error', simpleLogError);
}

function getOpenCol() {
    for (var i=0; i<10; i++) { // try 10 times
        var col = Math.floor(Math.random()*board.cols);
        if (pix[col] == -1) {
            return col;
        }
    }
    return -1;
}

function getRandColor() {
    var c = Math.floor(Math.random()*3);
    return COLORS[c];
}

function changeRange(inMin, inMax, value, outMin, outMax, bRound, bClip) {
    var p = (value - inMin) / (inMax - inMin) * 1.0;
    var n = p * (outMax - outMin) + outMin;
    // console.log("value = " + value + ", p = " + p + ", n = " + n + " [" + inMin + "-" + inMax + "] -> [" + outMin + "-" + outMax + "]");
    if (bRound) {
        n = Math.round(n);
    }
    if (bClip) {
        n = Math.min(outMax, Math.max(outMin, n));
    }
    return n;
}

function clearLines(topLine) {
    for (var y=topLine; y<board.rows; y++) {
        options.path = '/peggy/write?board='+board.id+'&x=0&y='+y+'&text=' + encodeURIComponent(repeatString(' ', board.cols));
        http.get(options).on('error', simpleLogError);
    }
}

initDrawWeather();
getWeather();
setInterval(getWeather, 60 * 1000);
setInterval(drawWeather, 1000);
