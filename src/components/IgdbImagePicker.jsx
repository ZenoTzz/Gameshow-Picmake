import React, { useEffect, useId, useRef, useState } from 'react';
import { Search, X, ArrowLeft } from 'lucide-react';
import { igdbApi } from '../utils/igdbApi';
import './igdbImagePicker.css';

const kindLabels = { screenshot: '截图', artwork: '宣传图', cover: '封面' };
export function IgdbImagePicker({ title, composing, image, onChoose }) {
  const labelId = useId();
  const dialog = useRef(null);
  const [override, setOverride] = useState(null);
  const [searchComposing, setSearchComposing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [games, setGames] = useState([]);
  const [searchState, setSearchState] = useState('idle');
  const [error, setError] = useState('');
  const [selectedGame, setSelectedGame] = useState(null);
  const [images, setImages] = useState([]);
  const [filter, setFilter] = useState('landscape');
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageState, setImageState] = useState('idle');
  const [imageError, setImageError] = useState('');
  const importRequest = useRef(null);
  const query = (override ?? title ?? '').trim();
  const onChooseRef = useRef(onChoose);
  onChooseRef.current = onChoose;

  function closeImages() {
    importRequest.current?.abort();
    importRequest.current = null;
    setSelectedGame(null);
    setSelectedImage(null);
    setImageError('');
  }
  useEffect(() => { setOverride(null); closeImages(); }, [title]);
  useEffect(() => { closeImages(); }, [image]);
  useEffect(() => () => importRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    setGames([]);
    setError('');
    if ([...query].length < 2 || composing || searchComposing) {
      setSearchState('idle');
      return () => controller.abort();
    }
    setSearchState('waiting');
    const timer = setTimeout(async () => {
      setSearchState('loading');
      try {
        const status = await igdbApi.status(controller.signal);
        if (!status.configured) throw new Error('服务器尚未配置 IGDB 凭据。配置完成后点击重试，仍可使用下方上传图片。');
        const result = await igdbApi.search(query, controller.signal);
        if (controller.signal.aborted) return;
        setGames(result.games.slice(0, 5));
        setSearchState('done');
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure.message);
        setSearchState('error');
      }
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, composing, searchComposing, retry]);

  useEffect(() => {
    if (!selectedGame) return undefined;
    const controller = new AbortController();
    setImages([]);
    setSelectedImage(null);
    setFilter('landscape');
    setImageError('');
    setImageState('loading');
    dialog.current?.showModal();
    igdbApi.images(selectedGame.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setImages(result.images);
      if (!result.images.some((item) => item.kind !== 'cover')) setFilter('cover');
      setImageState('done');
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      setImageError(failure.message);
      setImageState('error');
    });
    return () => { controller.abort(); importRequest.current?.abort(); };
  }, [selectedGame]);

  async function chooseImage() {
    if (!selectedImage || importRequest.current) return;
    const controller = new AbortController();
    importRequest.current = controller;
    setImageState('importing');
    setImageError('');
    try {
      const result = await igdbApi.importImage(selectedGame.id, selectedImage, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.dataUrl?.startsWith('data:image/')) throw new Error('服务器未返回有效图片，请重试。');
      closeImages();
      onChooseRef.current(result.dataUrl, result.source);
    } catch (failure) {
      if (!controller.signal.aborted) { setImageError(failure.message); setImageState('done'); }
    } finally {
      if (importRequest.current === controller) importRequest.current = null;
    }
  }
  const visibleImages = images.filter((item) => filter === 'all' || (filter === 'cover' ? item.kind === 'cover' : item.kind !== 'cover'));
  return <section className="igdb-picker" aria-labelledby={labelId}>
    <div className="igdb-heading"><strong id={labelId}><Search size={15} />IGDB 游戏搜图</strong><span>先确认游戏，再挑选图片</span></div>
    <label className="igdb-query">搜图关键词
      <input value={override ?? title ?? ''} placeholder="可输入英文名或别名" aria-label="IGDB 搜图关键词"
        onCompositionStart={() => setSearchComposing(true)} onCompositionEnd={() => setSearchComposing(false)}
        onChange={(event) => { closeImages(); setOverride(event.target.value); }} />
    </label>
    <p className="field-hint">自动匹配当前游戏名；修改这里不会改变卡片标题。找不到中文名时，可以试试英文名。</p>
    <div aria-live="polite" className="igdb-search-status">
      {searchState === 'idle' && '输入至少两个字符，即可查找游戏图片。'}
      {(searchState === 'loading' || searchState === 'waiting') && '正在匹配游戏…'}
      {searchState === 'done' && !games.length && '未找到匹配游戏，试试英文名、别名或更短的关键词。'}
      {error && <p>{error}</p>}
    </div>
    {searchState === 'error' && <button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>重试搜图</button>}
    <div className="igdb-game-results">{games.map((candidate) => <button type="button" className="igdb-game-result" key={candidate.id} onClick={() => setSelectedGame(candidate)}>
      {candidate.cover?.thumbnailUrl ? <img src={candidate.cover.thumbnailUrl} alt="" loading="lazy" /> : <span className="igdb-cover-placeholder">无封面</span>}
      <span><strong>{candidate.name}</strong><small>{[candidate.year, ...(candidate.platforms || []).slice(0, 3)].filter(Boolean).join(' · ') || '年份与平台待补充'}</small></span><span className="igdb-result-action">选图</span>
    </button>)}</div>
    {selectedGame && <dialog ref={dialog} className="igdb-dialog" aria-label={`为 ${selectedGame.name} 选择图片`} onCancel={(event) => { event.preventDefault(); closeImages(); }}>
      <div className="igdb-dialog-header"><button type="button" className="secondary-button" onClick={closeImages}><ArrowLeft size={16} />重新选游戏</button><button type="button" className="icon-button" aria-label="关闭 IGDB 选图" onClick={closeImages}><X size={20} /></button></div>
      <h2>{selectedGame.name}</h2><p className="field-hint">截图和宣传图更适合横向卡片。选择图片后，可继续裁剪为 16:9。</p>
      <div className="igdb-filters" role="group" aria-label="图片类型">{[['landscape', '截图 / 宣传图'], ['cover', '封面'], ['all', '全部']].map(([value, label]) => <button type="button" className="secondary-button" key={value} aria-pressed={filter === value} disabled={imageState === 'importing'} onClick={() => { setFilter(value); setSelectedImage(null); }}>{label}</button>)}</div>
      {imageState === 'loading' && <p role="status">正在加载备选图片…</p>}
      {imageError && <p role="alert">{imageError}</p>}
      {imageState === 'error' && <button type="button" className="secondary-button" onClick={() => setSelectedGame({ ...selectedGame })}>重新加载图片</button>}
      {imageState === 'done' && !visibleImages.length && <p>这个分类暂时没有图片，可以切换分类或上传自己的图片。</p>}
      {selectedImage && <div className="igdb-image-preview"><img src={selectedImage.previewUrl} alt={`${selectedGame.name} ${kindLabels[selectedImage.kind]}预览`} /><span>{kindLabels[selectedImage.kind]}{selectedImage.width && selectedImage.height ? ` · ${selectedImage.width} × ${selectedImage.height}` : ''}</span></div>}
      <div className="igdb-image-grid">{visibleImages.map((item) => <button type="button" key={`${item.kind}:${item.id}`} disabled={imageState === 'importing'} aria-pressed={selectedImage?.id === item.id && selectedImage?.kind === item.kind} aria-label={`预览${kindLabels[item.kind]} ${item.id}`} onClick={() => setSelectedImage(item)}><img src={item.thumbnailUrl} alt={`${selectedGame.name} ${kindLabels[item.kind]}`} loading="lazy" /><span>{kindLabels[item.kind]}</span></button>)}</div>
      <div className="igdb-dialog-footer"><a href={`https://www.igdb.com/search?type=1&q=${encodeURIComponent(selectedGame.name)}`} target="_blank" rel="noreferrer">图片来自 IGDB</a><button type="button" className="primary-button" disabled={!selectedImage || imageState === 'importing'} onClick={chooseImage}>{imageState === 'importing' ? '正在准备图片…' : '使用此图并裁剪'}</button></div>
    </dialog>}
  </section>;
}
