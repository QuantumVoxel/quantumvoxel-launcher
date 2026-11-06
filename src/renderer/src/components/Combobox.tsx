import "./Combobox.css";
import {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FaChevronDown } from "react-icons/fa";

interface ComboboxOption {
  value: string;
  label?: string;
  icon?: ReactNode;
}

interface ComboboxProps {
  options: (string | ComboboxOption)[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
}

function toOption(option: string | ComboboxOption): ComboboxOption {
  return typeof option === "string" ? { value: option, label: option } : { ...option, label: option.label ?? option.value };
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  allowCustom = false,
  icon,
  disabled = false,
  className = "",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  const opts = useMemo(() => options.map(toOption), [options]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % Math.max(1, opts.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? Math.max(1, opts.length) : a) - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && opts[active]) {
        select(opts[active].value);
      } else if (opts[0]) {
        select(opts[0].value);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={`combobox${className ? ` ${className}` : ""}`} ref={rootRef}>
      <div className="combobox-input-wrap">
        {icon && <span className="text-input-icon">{icon}</span>}
        <input
          className="combobox-input"
          value={value}
          readOnly
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onClick={(e: ReactPointerEvent<HTMLInputElement>) => {
            if (!open) setOpen(true);
            e.stopPropagation();
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
        <span className={`combobox-chevron${open ? " open" : ""}`}>
          <FaChevronDown/>
        </span>
      </div>
      {open && opts.length > 0 && (
        <div className="combobox-list">
          {opts.map((o, i) => (
            <button
              key={o.value}
              type="button"
              className={`combobox-item${i === active ? " active" : ""}${o.value === value ? " selected" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => select(o.value)}
            >
              {o.icon && <span className="combobox-item-icon">{o.icon}</span>}
              <span className="combobox-item-label">{o.label}</span>
              {o.value === value && <span className="combobox-item-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}