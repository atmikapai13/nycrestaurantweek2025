import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { filterMenuClass, filterPill } from "./filterPill";

export interface FilterOption {
  value: string;
  label: string | React.ReactNode;
  disabled?: boolean;
  icon?: string;
  /** Matching restaurants; shown in its own column when > 0. */
  count?: number;
}

interface FilterDropdownProps {
  label: string | React.ReactNode;
  icon?: string;
  options: FilterOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  /** Searchable list (Popover + Command) instead of a plain checkbox menu. */
  searchable?: boolean;
}

/**
 * A filter pill that opens a multi-select list. Options stay open while you tick several
 * (the bar's Reset clears them). Disabled options are ones with no results under the
 * other active filters.
 */
export default function FilterDropdown({
  label,
  icon,
  options,
  selectedValues,
  onChange,
  placeholder,
  searchable = false,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedValues);
  const hasSelections = selectedValues.length > 0;

  const toggle = (value: string) =>
    onChange(selected.has(value) ? selectedValues.filter((v) => v !== value) : [...selectedValues, value]);

  const trigger = (
    <button type="button" className={filterPill(hasSelections)} aria-label={typeof label === "string" ? `${label} filter` : undefined}>
      {icon && <span className="text-xs leading-none md:text-sm">{icon}</span>}
      <span>{label}</span>
      <ChevronDown className={cn("!size-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
  );

  // Count sits flush right, so counts line up down the menu
  const optionContent = (option: FilterOption) => (
    <>
      <span className="flex items-center gap-1.5">
        {option.icon && <img src={option.icon} alt="" className="h-4 w-4 object-contain" />}
        {option.label}
      </span>
      {option.count ? <span className="ml-auto pl-4 tabular-nums text-muted-foreground">{option.count}</span> : null}
    </>
  );

  const selectedRow = "bg-accent font-semibold";

  const empty = placeholder ?? "No options available";

  if (searchable) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className={cn(filterMenuClass, "w-[220px] overflow-hidden p-0")}>
          <Command>
            <CommandInput placeholder={`Search ${typeof label === "string" ? label.toLowerCase() : ""}…`} />
            <CommandList>
              <CommandEmpty>{empty}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    onSelect={() => toggle(option.value)}
                    className={cn("cursor-pointer gap-2 rounded-lg text-[13px]", selected.has(option.value) && selectedRow)}
                  >
                    {optionContent(option)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={filterMenuClass}>
        {options.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">{empty}</div>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.has(option.value)}
              disabled={option.disabled}
              onCheckedChange={() => toggle(option.value)}
              // Keep the menu open so several options can be ticked
              onSelect={(e) => e.preventDefault()}
              // No checkmark column: selected rows are highlighted pink instead
              className={cn(
                "cursor-pointer rounded-lg pl-2 text-[13px] [&>span:first-child]:hidden",
                selected.has(option.value) && selectedRow
              )}
            >
              {optionContent(option)}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
