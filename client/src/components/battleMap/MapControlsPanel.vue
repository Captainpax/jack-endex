<template>
  <CollapsibleSection class="map-controls-panel" :default-expanded="true">
    <template #header>
      <div class="map-controls-panel__summary">
        <span class="map-controls-panel__badge" :class="{ 'is-paused': isPaused }">
          {{ statusLabel }}
        </span>
        <span class="map-controls-panel__summary-item">
          <span class="map-controls-panel__summary-label">Drawer</span>
          <span class="map-controls-panel__summary-value">
            <span class="map-controls-panel__summary-text">{{ drawerDisplay }}</span>
            <span class="map-controls-panel__presence" :class="{ 'is-online': isDrawerOnline }">
              <span class="map-controls-panel__presence-dot" aria-hidden="true"></span>
              <span>{{ presenceLabel }}</span>
            </span>
          </span>
        </span>
        <span
          v-if="drawerAssignedLabel"
          class="map-controls-panel__summary-item"
        >
          <span class="map-controls-panel__summary-label">Assigned</span>
          <span class="map-controls-panel__summary-value">
            <span class="map-controls-panel__summary-text">{{ drawerAssignedLabel }}</span>
          </span>
        </span>
      </div>
    </template>
    <template #body>
      <div class="map-controls-panel__body">
        <dl class="map-controls-panel__details">
          <div class="map-controls-panel__detail">
            <dt>Status</dt>
            <dd>
              <span>{{ statusLabel }}</span>
            </dd>
          </div>
          <div class="map-controls-panel__detail">
            <dt>Drawing</dt>
            <dd>{{ drawingStatus }}</dd>
          </div>
          <div class="map-controls-panel__detail">
            <dt>Token moves</dt>
            <dd>{{ tokenStatus }}</dd>
          </div>
          <div class="map-controls-panel__detail" v-if="drawerName">
            <dt>Active drawer</dt>
            <dd>
              <span class="map-controls-panel__summary-text">{{ drawerName }}</span>
              <span class="map-controls-panel__presence" :class="{ 'is-online': isDrawerOnline }">
                <span class="map-controls-panel__presence-dot" aria-hidden="true"></span>
                <span>{{ presenceLabel }}</span>
              </span>
            </dd>
          </div>
          <div class="map-controls-panel__detail" v-if="drawerAssignedLabel">
            <dt>Assigned</dt>
            <dd>{{ drawerAssignedLabel }}</dd>
          </div>
        </dl>
        <div class="map-controls-panel__actions">
          <button
            type="button"
            class="btn ghost btn-small"
            :disabled="syncBusy"
            @click="emit('sync')"
          >
            <span class="map-controls-panel__action-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M5 5.5a6 6 0 019.5-1.5l1.5 1.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M15 14.5a6 6 0 01-9.5 1.5L4 14.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M13 4.5L15.5 7 13 9.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M7 15.5L4.5 13 7 10.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span v-if="syncBusy">Syncing…</span>
            <span v-else>Sync map</span>
          </button>
          <button
            type="button"
            class="btn ghost btn-small"
            :disabled="!canPause || pauseBusy"
            @click="emit('toggle-pause')"
          >
            <span class="map-controls-panel__action-icon" aria-hidden="true">
              <svg
                v-if="isPaused"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7 4l8 6-8 6V4z"
                  fill="currentColor"
                />
              </svg>
              <svg
                v-else
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7 5h2v10H7zM11 5h2v10h-2z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span v-if="pauseBusy">{{ isPaused ? 'Resuming…' : 'Pausing…' }}</span>
            <span v-else>{{ pauseButtonLabel }}</span>
          </button>
          <button
            type="button"
            class="btn ghost btn-small"
            :disabled="!canAssignDrawer || assignBusy"
            @click="emit('assign-drawer')"
          >
            <span class="map-controls-panel__action-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M9.5 10.5a3 3 0 100-6 3 3 0 000 6z"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M4.5 15.5c0-2.21 1.79-4 4-4h2"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M14.5 9.5v6"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M11.5 12.5h6"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span v-if="assignBusy">Working…</span>
            <span v-else>{{ assignButtonLabel }}</span>
          </button>
        </div>
      </div>
    </template>
  </CollapsibleSection>
</template>

<script setup>
import { computed } from 'vue';
import { CollapsibleSection } from '../ui';

const props = defineProps({
  mapState: { type: Object, required: true },
  drawerName: { type: String, default: '' },
  drawerAssignedLabel: { type: String, default: '' },
  isDrawerOnline: { type: Boolean, default: false },
  syncBusy: { type: Boolean, default: false },
  pauseBusy: { type: Boolean, default: false },
  assignBusy: { type: Boolean, default: false },
  canPause: { type: Boolean, default: true },
  canAssignDrawer: { type: Boolean, default: true },
  assignLabel: { type: String, default: 'Assign drawer' },
});

const emit = defineEmits(['sync', 'toggle-pause', 'assign-drawer']);

const isPaused = computed(() => !!props.mapState?.paused);
const statusLabel = computed(() => (isPaused.value ? 'Paused' : 'Live'));
const drawingStatus = computed(() =>
  props.mapState?.settings?.allowPlayerDrawing ? 'Enabled' : 'Disabled',
);
const tokenStatus = computed(() =>
  props.mapState?.settings?.allowPlayerTokenMoves ? 'Enabled' : 'Disabled',
);
const presenceLabel = computed(() => (props.isDrawerOnline ? 'Online' : 'Offline'));
const pauseButtonLabel = computed(() => (isPaused.value ? 'Resume map' : 'Pause map'));
const drawerDisplay = computed(() => props.drawerName || 'Unassigned');
const assignButtonLabel = computed(() => props.assignLabel || 'Assign drawer');
</script>
