"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export default function ServicesPage() {
  const services = useQuery(api.services.listActive, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Service Registry</h2>
        <span className="text-sm text-zinc-500">
          {services?.length ?? 0} active services
        </span>
      </div>

      {!services ? (
        <div className="text-zinc-500">Loading...</div>
      ) : services.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <p className="text-zinc-400 mb-2">No services listed yet</p>
          <p className="text-sm text-zinc-600">
            List a service via{" "}
            <code className="bg-zinc-800 px-1 rounded">
              POST /api/v1/agents/:id/services
            </code>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((service) => (
            <div
              key={service._id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-start justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-white">{service.name}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      service.serviceType === "api"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-blue-500/10 text-blue-400"
                    }`}
                  >
                    {service.serviceType}
                  </span>
                  <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                    {service.category}
                  </span>
                </div>
                <p className="text-sm text-zinc-400 mb-2">
                  {service.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {service.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-zinc-800/50 text-zinc-500 px-1.5 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="text-right ml-4">
                <p className="text-lg font-mono text-emerald-400">
                  ${(service.priceInCents / 100).toFixed(2)}
                </p>
                <p className="text-xs text-zinc-600">
                  {service.pricingModel.replace("_", "/")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
