import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { Restaurant } from '../types/restaurant';

export type GeoJSONGeometry = Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon;

export interface IsochroneLayer {
  id: string;
  polygon: GeoJSONGeometry;
  label: string;
  color: string;
  strokeColor: string;
  opacity: number;
  messageId?: string; // Track which message created this layer
}

interface MapContextType {
  // Layer state
  isochroneLayers: IsochroneLayer[];
  layerVisibilityMap: Map<string, boolean>;
  
  // Layer actions
  addLayers: (layers: IsochroneLayer[], messageId: string) => void;
  removeLayers: (messageId: string) => void;
  toggleLayerVisibility: (layerIds: string[]) => void;
  clearAllLayers: () => void;
  
  // Selected restaurant
  selectedRestaurant: Restaurant | null;
  setSelectedRestaurant: (restaurant: Restaurant | null) => void;
  
  // Isochrone region slugs (restaurants inside visible polygons)
  isochroneRegionSlugs: string[] | null;
  setIsochroneRegionSlugs: (slugs: string[] | null) => void;
}

const MapContext = createContext<MapContextType | undefined>(undefined);

export function MapProvider({ children }: { children: React.ReactNode }) {
  const [isochroneLayers, setIsochroneLayers] = useState<IsochroneLayer[]>([]);
  const [layerVisibilityMap, setLayerVisibilityMap] = useState<Map<string, boolean>>(new Map());
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [isochroneRegionSlugs, setIsochroneRegionSlugs] = useState<string[] | null>(null);

  const addLayers = useCallback((newLayers: IsochroneLayer[], messageId: string) => {
    console.log(`🗺️ MapContext: Adding ${newLayers.length} layers for message ${messageId}`);
    
    // Tag each layer with the messageId
    const taggedLayers = newLayers.map(layer => ({
      ...layer,
      messageId,
    }));
    
    setIsochroneLayers(prev => {
      // Remove any existing layers from this message first
      const filtered = prev.filter(l => l.messageId !== messageId);
      return [...filtered, ...taggedLayers];
    });
    
    // Initialize visibility to true for new layers
    setLayerVisibilityMap(prev => {
      const newMap = new Map(prev);
      taggedLayers.forEach(layer => {
        if (!newMap.has(layer.id)) {
          newMap.set(layer.id, true);
        }
      });
      return newMap;
    });
  }, []);

  const removeLayers = useCallback((messageId: string) => {
    console.log(`🗺️ MapContext: Removing layers for message ${messageId}`);
    
    // First, collect the layer IDs to remove
    const layerIdsToRemove: string[] = [];
    setIsochroneLayers(prev => {
      // Find layers to remove and collect their IDs
      prev.forEach(l => {
        if (l.messageId === messageId) {
          layerIdsToRemove.push(l.id);
        }
      });
      // Return filtered array
      return prev.filter(l => l.messageId !== messageId);
    });
    
    // Clean up visibility map using the collected IDs
    setLayerVisibilityMap(prev => {
      const newMap = new Map(prev);
      layerIdsToRemove.forEach(id => newMap.delete(id));
      return newMap;
    });
  }, []);

  const toggleLayerVisibility = useCallback((layerIds: string[]) => {
    console.log(`🗺️ MapContext: Toggling visibility for ${layerIds.length} layers`);
    
    setLayerVisibilityMap(prev => {
      const newMap = new Map(prev);
      
      // Check if all layers are currently visible
      const allVisible = layerIds.every(id => newMap.get(id) !== false);
      
      // Toggle: if all visible, hide them; if any hidden, show all
      layerIds.forEach(id => {
        newMap.set(id, !allVisible);
      });
      
      console.log(`🗺️ MapContext: Set layers to ${!allVisible ? 'visible' : 'hidden'}`);
      return newMap;
    });
  }, []);

  const clearAllLayers = useCallback(() => {
    console.log('🗺️ MapContext: Clearing all layers');
    setIsochroneLayers([]);
    setLayerVisibilityMap(new Map());
    setIsochroneRegionSlugs(null);
  }, []);

  return (
    <MapContext.Provider
      value={{
        isochroneLayers,
        layerVisibilityMap,
        addLayers,
        removeLayers,
        toggleLayerVisibility,
        clearAllLayers,
        selectedRestaurant,
        setSelectedRestaurant,
        isochroneRegionSlugs,
        setIsochroneRegionSlugs,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export function useMap() {
  const context = useContext(MapContext);
  if (context === undefined) {
    throw new Error('useMap must be used within a MapProvider');
  }
  return context;
}
