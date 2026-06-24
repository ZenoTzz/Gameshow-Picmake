import React, { createContext, useContext } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

const DragHandleContext = createContext(null);

export function DragHandle(props) {
  const listeners = useContext(DragHandleContext);
  return (
    <div {...listeners} {...props} style={{ cursor: "grab", ...props.style }}>
      {props.children}
    </div>
  );
}

export function SortableGameCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
    position: isDragging ? "relative" : "static",
  };

  return (
    <DragHandleContext.Provider value={listeners}>
      <div ref={setNodeRef} style={style} {...attributes}>
        {children}
      </div>
    </DragHandleContext.Provider>
  );
}

export function SortableGameList({ items, onDragEnd, children }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 拖动超过5px才认为是拖拽，防止误触点击
      },
    })
  );

  return (
    <DndContext 
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}
