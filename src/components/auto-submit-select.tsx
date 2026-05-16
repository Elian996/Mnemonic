"use client";

import * as React from "react";

type AutoSubmitSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function AutoSubmitSelect(props: AutoSubmitSelectProps) {
  return (
    <select
      {...props}
      onChange={(event) => {
        props.onChange?.(event);
        event.currentTarget.form?.requestSubmit();
      }}
    />
  );
}
