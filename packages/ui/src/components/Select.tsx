import { forwardRef, type SelectHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
  wrapperClassName?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      wrapperClassName,
      label,
      error,
      hint,
      options,
      placeholder,
      id,
      ...props
    },
    ref
  ) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className={twMerge('w-full', wrapperClassName)}>
        {label !== undefined && label !== '' && (
          <label
            htmlFor={selectId}
            className="mb-1.5 block text-sm font-medium text-dark-200"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={twMerge(
              clsx(
                'w-full appearance-none rounded-lg border bg-dark-800 px-4 py-2.5 pr-10 text-dark-100 transition-colors cursor-pointer',
                'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
                error !== undefined && error !== ''
                  ? 'border-error focus:border-error focus:ring-error'
                  : 'border-dark-600',
                className
              )
            )}
            {...props}
          >
            {placeholder !== undefined && placeholder !== '' && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-dark-500">
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
        {error !== undefined && error !== '' && (
          <p className="mt-1.5 text-sm text-error">{error}</p>
        )}
        {hint !== undefined && hint !== '' && (error === undefined || error === '') && (
          <p className="mt-1.5 text-sm text-dark-500">{hint}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

export default Select;
