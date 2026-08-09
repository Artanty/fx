import { Component, OnInit, OnDestroy, AfterViewInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiService } from '../../services/api.service';
import { TabDetail, TrackInfo } from '../../models';

declare var alphaTab: any;

@Component({
  selector: 'app-tab-viewer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tab-viewer.component.html',
  styleUrl: './tab-viewer.component.css',
})
export class TabViewerComponent implements OnInit, AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  tab: TabDetail | null = null;
  tabId = 0;

  private at: any = null;
  tracks: TrackInfo[] = [];
  currentTrack = 0;
  playing = false;
  speed = 1;
  loop = false;

  ngOnInit() {
    this.tabId = Number(this.route.snapshot.paramMap.get('id'));
    this.api.getTab(this.tabId).subscribe((t) => {
      this.tab = t;
      this.tracks = t.tracks;
    });
  }

  ngAfterViewInit() {
    this.initAlphaTab();
  }

  ngOnDestroy() {
    if (this.at) this.at.destroy();
  }

  private initAlphaTab() {
    if (!alphaTab) return;
    const settings = new alphaTab.Settings();
    settings.core.scriptFile = 'assets/alphatab/alphaTab.min.js';
    settings.core.fontDirectory = 'assets/alphatab/font/';
    settings.player.soundFont = 'assets/alphatab/soundfont/sonivox.sf2';
    settings.player.enablePlayer = true;
    settings.player.enableCursor = true;
    settings.player.enableUserInteraction = true;
    settings.display.scale = 0.9;

    this.at = new alphaTab.AlphaTabApi(document.getElementById('tab-host'), settings);
    this.at.soundFontLoad.on((args: any) => {});
    this.at.playerStateChanged.on((args: any) => {
      this.playing = args.state === 1;
    });
    this.at.load(this.api.getTabFileUrl(this.tabId));
  }

  togglePlay() {
    this.at.playPause();
  }

  stop() {
    this.at.stop();
  }

  setLoop() {
    this.loop = !this.loop;
    this.at.isLooping = this.loop;
  }

  setSpeed(value: string) {
    this.speed = parseFloat(value);
    this.at.playbackSpeed = this.speed;
  }

  selectTrack(index: number) {
    this.currentTrack = index;
    this.at.renderTracks([index]);
  }

  formatSize(bytes: number): string {
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }
}
