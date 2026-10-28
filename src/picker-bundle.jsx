import React, { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import EmojiPicker, { Theme as EmojiTheme, SuggestionMode } from 'emoji-picker-react';
import { GifPicker, Theme as GifTheme } from 'gif-picker-react';
import { Tenor } from 'gif-picker-react/providers/tenor';
import { Giphy } from 'gif-picker-react/providers/giphy';
import { Klipy } from 'gif-picker-react/providers/klipy';
import 'gif-picker-react/style.css';

// Custom GIF provider that connects to AConnect's backend /api/gifs endpoint
class AConnectGifProvider {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async getCategories() {
    return [
      { name: 'Trending', searchTerm: 'trending', imageUrl: 'https://media.giphy.com/media/Lq0h93752f6J9tijrh/200w.gif' },
      { name: 'Laugh', searchTerm: 'laugh', imageUrl: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/200w.gif' },
      { name: 'Love', searchTerm: 'love', imageUrl: 'https://media.giphy.com/media/26FLdmIp6wJr91JAI/200w.gif' },
      { name: 'Shocked', searchTerm: 'shocked', imageUrl: 'https://media.giphy.com/media/5VKbvrjxpVJCM/200w.gif' },
      { name: 'Dance', searchTerm: 'dance', imageUrl: 'https://media.giphy.com/media/blSTtZehjAZ8I/200w.gif' },
      { name: 'Sad', searchTerm: 'crying', imageUrl: 'https://media.giphy.com/media/d2lcHJTG5Tscg/200w.gif' },
      { name: 'Thumbs Up', searchTerm: 'thumbsup', imageUrl: 'https://media.giphy.com/media/111ebonMs90YLu/200w.gif' },
      { name: 'Facepalm', searchTerm: 'facepalm', imageUrl: 'https://media.giphy.com/media/131tNuGktpXGhy/200w.gif' },
      { name: 'Bye', searchTerm: 'bye', imageUrl: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/200w.gif' },
      { name: 'Party', searchTerm: 'party', imageUrl: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/200w.gif' },
      { name: 'Cat', searchTerm: 'cat', imageUrl: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/200w.gif' }
    ];
  }

  async getTrending() {
    const res = await fetch(`${this.baseUrl}/api/gifs?tag=trending&limit=48`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return this.mapGifs(data.gifs || []);
  }

  async search(term) {
    const res = await fetch(`${this.baseUrl}/api/gifs?q=${encodeURIComponent(term)}&limit=48`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return this.mapGifs(data.gifs || []);
  }

  mapGifs(list) {
    return list.map((g) => ({
      id: String(g.id || Math.random()),
      imageUrl: g.url,
      width: g.width || 200,
      height: g.height || 200,
      description: g.title || 'GIF',
      preview: {
        imageUrl: g.previewUrl || g.url,
        width: 200,
        height: 200
      },
      provider: 'aconnect',
      raw: g
    }));
  }

  getAttribution() {
    return {
      searchPlaceholder: 'Search GIFs...'
    };
  }
}

function EmojiGifTabsApp({ onEmojiClick, onGifClick, onClose, config = {} }) {
  const [activeTab, setActiveTab] = useState('emoji'); // 'emoji' | 'gif'

  const gifProvider = useMemo(() => {
    if (config.tenorApiKey) {
      try {
        return Tenor(config.tenorApiKey);
      } catch (e) {
        console.warn('Failed to init Tenor provider:', e);
      }
    }
    if (config.giphyApiKey) {
      try {
        return Giphy(config.giphyApiKey);
      } catch (e) {
        console.warn('Failed to init Giphy provider:', e);
      }
    }
    // Default to AConnectGifProvider which proxies to /api/gifs with Klipy/Giphy/fallback support
    return new AConnectGifProvider();
  }, [config.tenorApiKey, config.giphyApiKey]);

  return (
    <div className="react-picker-root">
      {/* Top Tabs Switcher */}
      <div className="react-picker-nav">
        <div className="react-picker-tabs">
          <button
            type="button"
            className={`react-picker-tab ${activeTab === 'emoji' ? 'active' : ''}`}
            onClick={() => setActiveTab('emoji')}
          >
            😃 Emojis
          </button>
          <button
            type="button"
            className={`react-picker-tab ${activeTab === 'gif' ? 'active' : ''}`}
            onClick={() => setActiveTab('gif')}
          >
            🎬 GIFs
          </button>
        </div>
        {onClose && (
          <button
            type="button"
            className="react-picker-close-btn"
            title="Close Panel"
            onClick={onClose}
          >
            ✕
          </button>
        )}
      </div>

      {/* Tab Panels */}
      <div className="react-picker-body">
        {activeTab === 'emoji' && (
          <div className="react-emoji-tab-content">
            <EmojiPicker
              theme={EmojiTheme.DARK}
              width="100%"
              height="100%"
              lazyLoadEmojis={true}
              searchPlaceHolder="Search all emojis..."
              previewConfig={{ showPreview: false }}
              suggestedEmojisMode={SuggestionMode.RECENT}
              onEmojiClick={(emojiData, event) => {
                event?.preventDefault?.();
                if (emojiData?.emoji) {
                  onEmojiClick?.(emojiData.emoji);
                }
              }}
            />
          </div>
        )}

        {activeTab === 'gif' && (
          <div className="react-gif-tab-content">
            <GifPicker
              theme={GifTheme.DARK}
              width="100%"
              height="100%"
              provider={gifProvider}
              onGifClick={(gif) => {
                if (gif?.imageUrl) {
                  onGifClick?.({
                    url: gif.imageUrl,
                    title: gif.description || 'Reaction GIF'
                  });
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Global Mount Function
window.mountEmojiGifPicker = function (containerEl, options = {}) {
  if (!containerEl) return null;
  const root = createRoot(containerEl);
  root.render(
    <EmojiGifTabsApp
      onEmojiClick={options.onEmojiClick}
      onGifClick={options.onGifClick}
      onClose={options.onClose}
      config={options.config || {}}
    />
  );
  return root;
};
