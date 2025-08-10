// PWA utility functions
export const registerServiceWorker = (): void => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('ServiceWorker registration successful with scope: ', registration.scope);
          
          // Check for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New version available
                  console.log('New content is available; please refresh.');
                  // You could show a toast notification here
                }
              });
            }
          });
        })
        .catch((error) => {
          console.log('ServiceWorker registration failed: ', error);
        });
    });
  }
};

// PWA install prompt
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export const setupInstallPrompt = (
  onInstallPromptAvailable: (canInstall: boolean) => void
): void => {
  // Listen for the beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    const event = e as BeforeInstallPromptEvent;
    // Prevent the mini-infobar from appearing on mobile
    event.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = event;
    // Update UI to notify the user they can install the PWA
    onInstallPromptAvailable(true);
  });

  // Handle the appinstalled event
  window.addEventListener('appinstalled', () => {
    console.log('PWA was installed');
    onInstallPromptAvailable(false);
    deferredPrompt = null;
  });
};

export const showInstallPrompt = async (): Promise<void> => {
  if (!deferredPrompt) {
    return;
  }

  // Show the install prompt
  await deferredPrompt.prompt();
  
  // Wait for the user to respond to the prompt
  const { outcome } = await deferredPrompt.userChoice;
  
  console.log(`User response to the install prompt: ${outcome}`);
  
  // We've used the prompt, and can't use it again, throw it away
  deferredPrompt = null;
};

// Check if app is running in standalone mode (installed as PWA)
export const isStandalone = (): boolean => {
  return window.matchMedia('(display-mode: standalone)').matches ||
         (window.navigator as any).standalone ||
         document.referrer.includes('android-app://');
};

// Cache restaurant data for offline use
export const cacheRestaurantData = async (data: any): Promise<void> => {
  if ('caches' in window) {
    try {
      const cache = await caches.open('nyc-restaurant-data-v1');
      const response = new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      await cache.put('/api/restaurants', response);
      console.log('Restaurant data cached successfully');
    } catch (error) {
      console.error('Failed to cache restaurant data:', error);
    }
  }
};

// Check online/offline status
export const setupOnlineStatusDetection = (
  onOnlineStatusChange: (isOnline: boolean) => void
): void => {
  const updateOnlineStatus = () => {
    onOnlineStatusChange(navigator.onLine);
  };

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  
  // Initial status check
  updateOnlineStatus();
};