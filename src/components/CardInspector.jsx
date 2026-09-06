import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { GameEditor } from './GameEditor.jsx';

export function CardInspector({ game, index, total, onClose, onSelectAdjacent, ...editorProps }) {
  const panel = useRef(null);
  useEffect(() => {
    panel.current?.querySelector('input')?.focus({ preventScroll: true });
    panel.current?.scrollTo({ top: 0 });
  }, [game.id]);
  return <section className="card-inspector" id="card-inspector" aria-label="卡片编辑" ref={panel}>
    <header className="inspector-heading">
      <div><small>卡片 {index + 1} / {total}</small><h2>编辑卡片</h2></div>
      <div className="inspector-navigation">
        <button className="icon-button" type="button" disabled={index === 0} aria-label="编辑上一张卡片" onClick={() => onSelectAdjacent(-1)}><ChevronLeft size={18}/></button>
        <button className="icon-button" type="button" disabled={index === total - 1} aria-label="编辑下一张卡片" onClick={() => onSelectAdjacent(1)}><ChevronRight size={18}/></button>
        <button className="icon-button" type="button" aria-label="返回卡片列表" onClick={onClose}><X size={18}/></button>
      </div>
    </header>
    <GameEditor key={game.id} mode="details" game={game} index={index} total={total} isExpanded {...editorProps}/>
    <div className="inspector-card-actions">
      <button className="text-button" type="button" disabled={index === 0} onClick={() => editorProps.onMove(-1)}>上移卡片</button>
      <button className="text-button" type="button" disabled={index === total - 1} onClick={() => editorProps.onMove(1)}>下移卡片</button>
      <button className="text-button" type="button" onClick={editorProps.onRemove}>删除卡片</button>
    </div>
    <footer className="inspector-footer"><span>修改即时生效，可撤销</span><button className="secondary-button" type="button" onClick={onClose}>完成编辑</button></footer>
  </section>;
}
