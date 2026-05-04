import React, { useEffect, useState } from 'react';
import { type PluginComponentProps } from '../componentRegistry';

interface Service {
  id: string;
  name: string;
  type: string;
  url?: string;
  description: string;
  status?: 'online' | 'offline' | 'error' | 'unknown' | 'loading';
}

export default function ServicesPage({ plugin, apiBase = '' }: PluginComponentProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServices = async () => {
    try {
      const res = await fetch(`${apiBase}/api/plugins/services/list`);
      const data = await res.json();
      setServices(data.services.map((s: any) => ({ ...s, status: 'loading' })));
      setLoading(false);

      // Fetch statuses individually
      data.services.forEach(async (service: any) => {
        try {
          const statusRes = await fetch(`${apiBase}/api/plugins/services/status/${service.id}`);
          const statusData = await statusRes.json();
          setServices(prev => prev.map(s => s.id === service.id ? { ...s, status: statusData.status } : s));
        } catch {
          setServices(prev => prev.map(s => s.id === service.id ? { ...s, status: 'error' } : s));
        }
      });
    } catch (err) {
      console.error('[Services] Failed to load services:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Services</h1>
            <p className="text-[var(--text-muted)]">Monitor operational health across the fleet.</p>
          </div>
          <button 
            onClick={() => { setLoading(true); fetchServices(); }}
            className="mc-shell-btn px-4 py-2 text-sm"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-[var(--text-muted)]">
            Loading services...
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map(service => (
              <div key={service.id} className="mc-shell-card border border-[var(--border-secondary)] p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div className="font-semibold text-[var(--text-primary)]">{service.name}</div>
                  <div className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    service.status === 'online' ? 'bg-green-500/20 text-green-400' :
                    service.status === 'offline' ? 'bg-red-500/20 text-red-400' :
                    service.status === 'error' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {service.status || 'unknown'}
                  </div>
                </div>
                <div className="mb-4 text-xs text-[var(--text-secondary)]">
                  {service.description}
                </div>
                <div className="flex items-center gap-2">
                  {service.url && (
                    <a 
                      href={service.url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-[10px] text-[var(--accent)] hover:underline"
                    >
                      {service.url}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
