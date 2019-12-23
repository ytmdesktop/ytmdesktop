const { remote, ipcRenderer } = require("electron");

window.ipcRenderer = ipcRenderer;
var content = remote.getCurrentWebContents();

content.addListener("dom-ready", function() {
  createMenu();
});

function createMenu() {
  content.executeJavaScript(`
        var materialIcons = document.createElement('link');
        materialIcons.setAttribute('href', 'https://fonts.googleapis.com/icon?family=Material+Icons');
        materialIcons.setAttribute('rel', 'stylesheet');

        document.body.prepend(materialIcons);
    `);

  content.insertCSS(`
        #ytmd-menu {
            visibility: hidden;
            opacity: 0;
            position: fixed;
            background: #232323;
            /*color: #AAA;*/
            font-family: sans-serif;

            -webkit-transition: opacity .2s ease-in-out;
            transition: opacity .2s ease-in-out;
            
            padding: 0 !important;
            
            border: 1px solid rgba(255, 255, 255, .08) !important;
            border-radius: 2px !important;

            z-index: 999999 !important;

            min-width: 208px;
        }
    
        #ytmd-menu a {
            color: #AAA;
            display: inline-block;
            cursor: pointer;

            padding: 10px 12px 6px 12px;
        }

        #ytmd-menu a:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }

        .divider {
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            height: 21px;
            display: inline-block;
        }

        .hide {
            visibility: hidden;
        }

        .pointer {
            cursor: pointer;
        }

        .ytmd-icons {
            margin: 0 20px 0 10px !important;
        }
    `);

  var menu = `<a id="ytmd-menu-history-back"><i class="material-icons">chevron_left</i></a> <div class="divider"></div> <a id="ytmd-menu-settings"><i class="material-icons">settings</i></a> <a id="ytmd-menu-lyrics"><i class="material-icons">music_note</i></a> <a id="ytmd-menu-companion-server"><i class="material-icons">surround_sound</i></a>`;

  content.executeJavaScript(`
        var menuDiv = document.createElement("div");
        menuDiv.setAttribute('id', 'ytmd-menu');
        menuDiv.innerHTML = '${menu}';
        document.body.prepend(menuDiv);
    `);

  content.executeJavaScript(`
        var i = document.getElementById("ytmd-menu").style;
    
        if (document.addEventListener) {
            document.addEventListener('contextmenu', function (e) {
            var posX = e.clientX;
            var posY = e.clientY;
            menu(posX, posY);
            e.preventDefault();
            }, false);
            document.addEventListener('click', function (e) {
            i.opacity = "0";
            setTimeout(function () {
                i.visibility = "hidden";
            }, 501);
            }, false);
        } else {
            document.attachEvent('oncontextmenu', function (e) {
            var posX = e.clientX;
            var posY = e.clientY;
            menu(posX, posY);
            e.preventDefault();
            });
            document.attachEvent('onclick', function (e) {
            i.opacity = "0";
            setTimeout(function () {
                i.visibility = "hidden";
            }, 501);
            });
        }

        function menu(x, y) {
            i.top = y + "px";
            i.left = x + "px";
            i.visibility = "visible";
            i.opacity = "1";
        }
    `);

  content.executeJavaScript(`
        var buttonHistoryBack = document.getElementById('ytmd-menu-history-back');
        var buttonOpenSettings = document.getElementById('ytmd-menu-settings');
        var buttonOpenLyrics = document.getElementById('ytmd-menu-lyrics');
        var buttonOpenCompanion = document.getElementById('ytmd-menu-companion-server');

        if (buttonHistoryBack) {
            buttonHistoryBack.addEventListener('click', function() { history.go(-1); } );
        }

        if (buttonOpenSettings) {
            buttonOpenSettings.addEventListener('click', function() { ipcRenderer.send('show-settings'); } );
        }
        
        if (buttonOpenLyrics) {
            buttonOpenLyrics.addEventListener('click', function() { ipcRenderer.send('show-lyrics'); } );
        }
        
        if (buttonOpenCompanion) {
            buttonOpenCompanion.addEventListener('click', function() { ipcRenderer.send('show-companion'); } );
        }
    `);

  content.executeJavaScript(
    `
            var right_content = document.getElementById('right-content');


            // SETTINGS
            var element = document.createElement('i');
            element.id = 'ytmd_settings';
            element.classList.add('material-icons', 'green-text', 'pointer', 'ytmd-icons');
            element.innerText = 'settings';

            element.addEventListener('click', function() { ipcRenderer.send('show-settings'); } )
            
            right_content.prepend(element);

    `
  );
}
