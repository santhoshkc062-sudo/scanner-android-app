import { Component, OnInit ,PLATFORM_ID, Inject, NgZone, ChangeDetectorRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning';
import { isPlatformBrowser, } from '@angular/common';
import { DataTransfer } from './services/data-transfer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {

  ipAddress: string = '';
  isIpSet: boolean = false;
  scanResult: string = '';

  constructor(private zone: NgZone, 
    @Inject(PLATFORM_ID) private platformId: Object,
    private cd: ChangeDetectorRef,
    private dataTransfer: DataTransfer
  ) {}

  ngOnInit() {
    // Check if IP was already saved previously
    if (isPlatformBrowser(this.platformId)) {
      const savedIp = localStorage.getItem('serverIp');
      if (savedIp) {
        this.ipAddress = savedIp;
        this.isIpSet = true;
      }
    }
  }

  setIp() {
    if (this.ipAddress.trim() !== '') {
      // Check again before saving
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('serverIp', this.ipAddress);
      }
      this.isIpSet = true;
    } else {
      alert('Please enter IP Address');
    }
  }

async scanQR() {
  try {

    const permission = await BarcodeScanner.requestPermissions();
    if (permission.camera !== 'granted') {
      alert('Camera permission denied');
      return;
    }

    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();

    if (!available) {
      alert('Scanner module missing. Downloading now... please wait 10 seconds and try again.');
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      return;
    }

    const result = await BarcodeScanner.scan();

    if (result.barcodes.length > 0) {

      const value = result.barcodes[0].rawValue!;

      const paylod = { barcode : value };

      // this.zone.run(() => {
      //   this.scanResult = value;
      //   this.cd.detectChanges();
      // });

      this.dataTransfer.sendData({ qr: paylod }).subscribe(
  (response: any) => {

    this.zone.run(() => {
      this.scanResult = response.message || JSON.stringify(response);
      this.cd.detectChanges();
    });

  },
  (error) => {

    this.zone.run(() => {
      this.scanResult = 'Server Error';
      this.cd.detectChanges();
    });

  }
);

      await BarcodeScanner.stopScan();
    }

  } catch (error) {
    console.error('Scan Error:', error);
    alert('Scanning failed. Make sure Google Play Services is updated.');
  }
}


  resetIp() {
    this.isIpSet = false;
    this.scanResult = '';
  }

  rescan() {
  this.scanResult = '';
  this.scanQR();
}

datasent(){

  const payload = {
     barcode: "P4949683;S2001;D26001;V059428"
  }
  this.dataTransfer.sendData(payload).subscribe(
    (response: any) => {
      console.log('Data cleared on server:', response);
    },
    (error) => {
      alert('Failed to clear data on server');
    }
  );
}
}