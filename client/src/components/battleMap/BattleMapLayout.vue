<template>
    <section class="map-tab">
        <div class="map-tab__header">
            <slot name="header" />
        </div>
        <div class="map-layout">
            <div class="map-board-wrapper">
                <slot name="board" />
            </div>
            <slot name="sidebar" />
        </div>
    </section>
</template>
