import React from "react";

interface HeaderProps {
    title: string;
    description: string;
    children?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ title, description, children }) => (
    <div className="flex items-center justify-between">
        <div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            <p className="text-muted-foreground">{description}</p>
        </div>
        {children && <div className="ml-4">{children}</div>}
    </div>
);