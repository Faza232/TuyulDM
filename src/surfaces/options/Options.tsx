import { useState, useMemo } from 'react';
import { Tabs, TabList, Tab, TabPanel } from '../../ui/primitives';
import { Search } from '../../ui/icons';

import { GeneralSection } from './sections/General';
import { DetectionSection } from './sections/Detection';
import { NetworkSection } from './sections/Network';
import { AdaptersSection } from './sections/Adapters';
import { StorageSection } from './sections/Storage';
import { LoggingSection } from './sections/Logging';
import { AboutSection } from './sections/About';

export default function Options() {
  const [activeTab, setActiveTab] = useState('general');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex flex-col h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Header */}
      <header className="h-[48px] px-6 border-b border-[var(--color-border-subtle)] flex items-center justify-between shrink-0 bg-[var(--color-surface)]">
         <div className="flex items-center gap-3">
           <div className="flex items-center justify-center size-6 rounded bg-[var(--color-accent)] text-[var(--color-bg)] font-bold text-xs">t.</div>
           <span className="font-semibold tracking-tight text-[14px]">TuyulDM Settings</span>
         </div>
         
         <div className="relative w-64">
           <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-text-muted)]" />
           <input
             type="text"
             placeholder="Search settings..."
             value={searchQuery}
             onChange={e => setSearchQuery(e.target.value)}
             className="w-full h-8 pl-8 pr-3 bg-white/5 border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[12px] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
           />
         </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 min-h-0 container max-w-5xl mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="h-full items-start gap-12">
          {/* Sidebar */}
          <div className="w-48 shrink-0 sticky top-8">
            <TabList ariaLabel="Settings tabs" className="pr-6">
              <Tab value="general">General</Tab>
              <Tab value="detection">Detection</Tab>
              <Tab value="network">Network</Tab>
              <Tab value="adapters">Adapters</Tab>
              <Tab value="storage">Storage</Tab>
              <Tab value="logging">Logging</Tab>
              <div className="h-px bg-[var(--color-border-subtle)] my-2 mr-2" />
              <Tab value="about">About</Tab>
            </TabList>
          </div>
          
          {/* Content Pane */}
          <div className="flex-1 overflow-y-auto pr-4 pb-12 w-full max-w-2xl">
            <TabPanel value="general">
               <GeneralSection searchQuery={searchQuery} />
            </TabPanel>
            <TabPanel value="detection">
               <DetectionSection searchQuery={searchQuery} />
            </TabPanel>
            <TabPanel value="network">
               <NetworkSection searchQuery={searchQuery} />
            </TabPanel>
            <TabPanel value="adapters">
               <AdaptersSection searchQuery={searchQuery} />
            </TabPanel>
            <TabPanel value="storage">
               <StorageSection searchQuery={searchQuery} />
            </TabPanel>
            <TabPanel value="logging">
               <LoggingSection searchQuery={searchQuery} />
            </TabPanel>
            <TabPanel value="about">
               <AboutSection searchQuery={searchQuery} />
            </TabPanel>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
