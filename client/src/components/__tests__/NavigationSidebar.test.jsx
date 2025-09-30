import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NavigationSidebar from "../NavigationSidebar.jsx";
import { buildNavigation } from "../../constants/navigation.js";

const AVAILABLE_KEYS = new Set([
    "overview",
    "sheet",
    "party",
    "map",
    "items",
    "gear",
    "combatSkills",
    "worldSkills",
    "demons",
    "storyLogs",
    "help",
    "settings",
    "serverManagement",
]);

function NavigationHarness({ navItems }) {
    const [active, setActive] = React.useState(navItems[0]?.key ?? null);

    return (
        <div>
            <NavigationSidebar items={navItems} activeKey={active} onSelect={setActive} />
            <div>
                {navItems.map((item) => (
                    <section
                        key={item.key}
                        data-testid={`panel-${item.key}`}
                        hidden={item.key !== active}
                    >
                        {`${item.label} panel`}
                    </section>
                ))}
            </div>
        </div>
    );
}

describe("NavigationSidebar", () => {
    it("activates the corresponding panel when each tab is selected", async () => {
        const navItems = buildNavigation({
            role: "dm",
            isServerAdmin: true,
            availableKeys: AVAILABLE_KEYS,
        });
        const user = userEvent.setup();

        render(<NavigationHarness navItems={navItems} />);

        for (const item of navItems) {
            const button = screen.getByRole("button", { name: item.label });
            await user.click(button);

            const activePanel = screen.getByTestId(`panel-${item.key}`);
            expect(activePanel).toBeVisible();
            expect(button).toHaveAttribute("aria-pressed", "true");

            for (const other of navItems) {
                if (other.key === item.key) continue;
                expect(screen.getByTestId(`panel-${other.key}`)).not.toBeVisible();
                const otherButton = screen.getByRole("button", { name: other.label });
                expect(otherButton).toHaveAttribute("aria-pressed", "false");
            }
        }
    });
});
