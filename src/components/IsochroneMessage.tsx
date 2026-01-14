import React, { useMemo } from 'react';
import { useMap } from '../contexts/MapContext';

interface IsochroneMessageProps {
  messageId: string;
}

export function IsochroneMessage({ messageId }: IsochroneMessageProps) {
  const { isochroneLayers, layerVisibilityMap, toggleLayerVisibility } = useMap();

  // Find all layers belonging to this message
  const myLayerIds = useMemo(() => {
    return isochroneLayers
      .filter(layer => layer.messageId === messageId)
      .map(layer => layer.id);
  }, [isochroneLayers, messageId]);

  // Check if all layers are visible
  const areLayersVisible = useMemo(() => {
    if (myLayerIds.length === 0) return false;
    return myLayerIds.every(id => layerVisibilityMap.get(id) !== false);
  }, [myLayerIds, layerVisibilityMap]);

  // Don't render if no layers
  if (myLayerIds.length === 0) return null;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log(
      `👆 IsochroneMessage: Toggling ${myLayerIds.length} layers for message ${messageId}`
    );
    toggleLayerVisibility(myLayerIds);
  };

  return (
    <div className="tool-status-container">
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          marginTop: '4px',
        }}
      >
        <button
          onClick={handleToggle}
          className="isochrone-toggle-button"
          style={{
            background: areLayersVisible
              ? 'rgba(255, 105, 180, 0.1)'
              : 'rgba(100, 100, 100, 0.1)',
            borderColor: areLayersVisible
              ? 'rgba(255, 105, 180, 0.3)'
              : 'rgba(100, 100, 100, 0.3)',
            color: areLayersVisible ? '#ff69b4' : '#666',
          }}
          title={
            areLayersVisible
              ? 'Hide polygons from this message'
              : 'Show polygons from this message'
          }
        >
          {areLayersVisible ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.45 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          )}
          <span style={{ marginLeft: '4px' }}>
            {areLayersVisible ? 'Hide Polygons' : 'Show Polygons'}
          </span>
        </button>
      </div>
    </div>
  );
}

