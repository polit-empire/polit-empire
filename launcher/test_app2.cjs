const { JSDOM } = require('jsdom');

JSDOM.fromURL("http://localhost:3000", {
  runScripts: "dangerously",
  resources: "usable",
  beforeParse(window) {
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd === 'verify_session') return { valid: true, nickname: 'Artem', banned: false };
        if (cmd === 'check_launcher_update') return { available: false, latestVersion: '2.2.11', currentVersion: '2.2.11', changelog: '' };
        if (cmd === 'get_news') return [];
        if (cmd === 'is_game_running') return false;
        if (cmd === 'get_playtime_stats') return { total_seconds: 100, session_count: 1, last_session_seconds: 100, longest_session_seconds: 100, last_played_unix: 0 };
        if (cmd === 'get_player_stats') return { kills: 10, deaths: 0, town: "Test" };
        if (cmd === 'get_skin_url') return null;
        return null;
      }
    };
  }
}).then(dom => {
  dom.window.addEventListener('error', (event) => {
    console.error("DOM ERROR:", event.error);
  });
  dom.window.addEventListener('unhandledrejection', (event) => {
    console.error("UNHANDLED REJECTION:", event.reason);
  });
  
  setTimeout(() => {
    // Click on Profile tab
    const tabs = dom.window.document.querySelectorAll('button');
    let profileBtn = null;
    for(let btn of tabs) {
      if(btn.textContent.includes('Профиль')) {
        profileBtn = btn;
      }
    }
    if (profileBtn) {
      console.log("Found Profile button, clicking...");
      profileBtn.click();
    } else {
      console.log("Profile button not found.");
      console.log(dom.window.document.body.innerHTML.substring(0, 500));
    }
  }, 2000);

  setTimeout(() => {
    console.log("Done waiting.");
  }, 4000);
});
